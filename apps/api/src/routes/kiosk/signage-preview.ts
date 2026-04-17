import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { isSignageDisplayClientDeviceApiKey } from '../../lib/signage/signage-display-client.js';
import { resolveEffectiveKioskSignagePreviewApiKey } from '../../lib/signage/kiosk-signage-preview-target.js';

const selectionBodySchema = z.object({
  signagePreviewTargetApiKey: z.string().min(1).nullable(),
});

type SignagePreviewRouteDeps = {
  requireClientDevice: (rawClientKey: unknown) => Promise<{
    clientKey: string;
    clientDevice: { id: string };
  }>;
};

async function listSignageCandidateDevices(): Promise<
  Array<{ id: string; name: string; location: string | null; apiKey: string }>
> {
  return prisma.clientDevice.findMany({
    where: {
      apiKey: {
        contains: 'signage',
        mode: 'insensitive',
      },
    },
    select: { id: true, name: true, location: true, apiKey: true },
    orderBy: { name: 'asc' },
  });
}

export async function registerKioskSignagePreviewRoutes(
  app: FastifyInstance,
  deps: SignagePreviewRouteDeps
): Promise<void> {
  app.get('/kiosk/signage-preview/options', { config: { rateLimit: false } }, async (request) => {
    const rawHeader = request.headers['x-client-key'];
    const { clientKey, clientDevice } = await deps.requireClientDevice(rawHeader);

    const row = await prisma.clientDevice.findUnique({
      where: { id: clientDevice.id },
      select: { signagePreviewTargetApiKey: true },
    });

    const candidates = await listSignageCandidateDevices();
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
      await prisma.clientDevice.update({
        where: { id: clientDevice.id },
        data: { signagePreviewTargetApiKey: null },
      });
      return { ok: true as const, signagePreviewTargetApiKey: null as string | null };
    }

    const targetKey = body.signagePreviewTargetApiKey.trim();
    if (!isSignageDisplayClientDeviceApiKey(targetKey)) {
      throw new ApiError(400, 'サイネージ表示端末のAPIキーのみ選択できます', undefined, 'INVALID_SIGNAGE_PREVIEW_TARGET');
    }

    const targetDevice = await prisma.clientDevice.findUnique({
      where: { apiKey: targetKey },
      select: { id: true },
    });
    if (!targetDevice) {
      throw new ApiError(400, '指定された端末が見つかりません', undefined, 'SIGNAGE_PREVIEW_TARGET_NOT_FOUND');
    }

    await prisma.clientDevice.update({
      where: { id: clientDevice.id },
      data: { signagePreviewTargetApiKey: targetKey },
    });

    return { ok: true as const, signagePreviewTargetApiKey: targetKey };
  });
}
