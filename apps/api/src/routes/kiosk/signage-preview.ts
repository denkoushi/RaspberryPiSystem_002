import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ApiError } from '../../lib/errors.js';
import { isSignageDisplayClientDeviceApiKey } from '../../lib/signage/signage-display-client.js';
import { resolveEffectiveKioskSignagePreviewApiKey } from '../../lib/signage/kiosk-signage-preview-target.js';
import {
  clearSignagePreviewTarget,
  findSignagePreviewTargetDeviceByApiKey,
  getSignagePreviewTarget,
  listSignagePreviewCandidates,
  setSignagePreviewTarget
} from '../../services/kiosk/kiosk-signage-preview.service.js';

const selectionBodySchema = z.object({
  signagePreviewTargetApiKey: z.string().min(1).nullable(),
});

type SignagePreviewRouteDeps = {
  requireClientDevice: (rawClientKey: unknown) => Promise<{
    clientKey: string;
    clientDevice: { id: string };
  }>;
};

export async function registerKioskSignagePreviewRoutes(
  app: FastifyInstance,
  deps: SignagePreviewRouteDeps
): Promise<void> {
  app.get('/kiosk/signage-preview/options', { config: { rateLimit: false } }, async (request) => {
    const rawHeader = request.headers['x-client-key'];
    const { clientKey, clientDevice } = await deps.requireClientDevice(rawHeader);

    const row = await getSignagePreviewTarget(clientDevice.id);

    const candidates = await listSignagePreviewCandidates();
    const signageApiKeys = new Set(candidates.map((c) => c.apiKey));
    const selectedApiKeyRaw = row?.signagePreviewTargetApiKey ?? null;
    const selectedApiKey = selectedApiKeyRaw && signageApiKeys.has(selectedApiKeyRaw) ? selectedApiKeyRaw : null;
    const effectivePreviewApiKey = resolveEffectiveKioskSignagePreviewApiKey({
      kioskApiKey: clientKey,
      storedTarget: selectedApiKey,
      validSignageApiKeys: signageApiKeys,
    });

    return {
      candidates,
      selectedApiKey,
      effectivePreviewApiKey,
    };
  });

  app.put('/kiosk/signage-preview/selection', { config: { rateLimit: false } }, async (request) => {
    const rawHeader = request.headers['x-client-key'];
    const { clientDevice } = await deps.requireClientDevice(rawHeader);

    const body = selectionBodySchema.parse(request.body);

    if (body.signagePreviewTargetApiKey === null) {
      await clearSignagePreviewTarget(clientDevice.id);
      return { ok: true as const, signagePreviewTargetApiKey: null as string | null };
    }

    const targetKey = body.signagePreviewTargetApiKey.trim();
    if (!isSignageDisplayClientDeviceApiKey(targetKey)) {
      throw new ApiError(400, 'サイネージ表示端末のAPIキーのみ選択できます', undefined, 'INVALID_SIGNAGE_PREVIEW_TARGET');
    }

    const targetDevice = await findSignagePreviewTargetDeviceByApiKey(targetKey);
    if (!targetDevice) {
      throw new ApiError(400, '指定された端末が見つかりません', undefined, 'SIGNAGE_PREVIEW_TARGET_NOT_FOUND');
    }

    await setSignagePreviewTarget(clientDevice.id, targetKey);

    return { ok: true as const, signagePreviewTargetApiKey: targetKey };
  });
}
