import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ApiError } from '../../lib/errors.js';
import { SignageRenderStorage } from '../../lib/signage-render-storage.js';
import { SignageRenderer } from '../../services/signage/signage.renderer.js';
import { SignageService } from '../../services/signage/index.js';
import {
  clearSignagePreviewTarget,
  getSignagePreviewTarget,
  listSignagePreviewCandidates,
  resolveSignagePreviewTargetClientDeviceId,
  setSignagePreviewTarget
} from '../../services/kiosk/kiosk-signage-preview.service.js';

const selectionBodySchema = z.union([
  z.object({ signagePreviewTargetClientDeviceId: z.string().uuid().nullable() }).strict(),
  // Accept a cached old client's input, but never return the supplied credential.
  z.object({ signagePreviewTargetApiKey: z.string().min(1).nullable() }).strict(),
]);
const imageQuerySchema = z.object({ clientDeviceId: z.string().uuid().optional() });

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
  const renderer = new SignageRenderer(new SignageService());
  app.get('/kiosk/signage-preview/options', { config: { rateLimit: false } }, async (request) => {
    const rawHeader = request.headers['x-client-key'];
    const { clientDevice } = await deps.requireClientDevice(rawHeader);

    const row = await getSignagePreviewTarget(clientDevice.id);

    const candidates = await listSignagePreviewCandidates();
    const selectedClientDeviceId = resolveSignagePreviewTargetClientDeviceId(row?.signagePreviewTargetApiKey ?? null, candidates);

    return {
      candidates: candidates.map(({ id, name, location }) => ({ id, name, location })),
      selectedClientDeviceId,
      effectivePreviewClientDeviceId: selectedClientDeviceId ?? clientDevice.id,
    };
  });

  app.put('/kiosk/signage-preview/selection', { config: { rateLimit: false } }, async (request) => {
    const rawHeader = request.headers['x-client-key'];
    const { clientDevice } = await deps.requireClientDevice(rawHeader);

    const body = selectionBodySchema.parse(request.body);

    const target = 'signagePreviewTargetClientDeviceId' in body
      ? body.signagePreviewTargetClientDeviceId
      : body.signagePreviewTargetApiKey;
    if (target === null) {
      await clearSignagePreviewTarget(clientDevice.id);
      return { ok: true as const, signagePreviewTargetClientDeviceId: null as string | null };
    }

    const candidates = await listSignagePreviewCandidates();
    const targetDevice = candidates.find((candidate) => 'signagePreviewTargetClientDeviceId' in body
      ? candidate.id === target
      : candidate.apiKey === target.trim());
    if (!targetDevice) {
      throw new ApiError(400, '登録済みサイネージ端末のみ選択できます', undefined, 'INVALID_SIGNAGE_PREVIEW_TARGET');
    }

    await setSignagePreviewTarget(clientDevice.id, targetDevice.id);

    return { ok: true as const, signagePreviewTargetClientDeviceId: targetDevice.id };
  });

  app.get('/kiosk/signage-preview/image', async (request, reply) => {
    const { clientKey, clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const query = imageQuerySchema.parse(request.query);
    const candidates = await listSignagePreviewCandidates();
    const row = query.clientDeviceId ? null : await getSignagePreviewTarget(clientDevice.id);
    const targetId = query.clientDeviceId
      ?? resolveSignagePreviewTargetClientDeviceId(row?.signagePreviewTargetApiKey ?? null, candidates)
      ?? clientDevice.id;
    const candidate = candidates.find((device) => device.id === targetId);
    if (targetId !== clientDevice.id && !candidate) {
      throw new ApiError(404, 'プレビュー対象のサイネージ端末が見つかりません', undefined, 'SIGNAGE_PREVIEW_TARGET_NOT_FOUND');
    }
    // Only the server resolves the display credential. Preview reads do not count as device delivery.
    const imageKey = targetId === clientDevice.id ? clientKey : candidate!.apiKey;
    const image = await SignageRenderStorage.readCurrentImage(imageKey)
      ?? await renderer.renderMessage('表示するコンテンツがありません');
    return reply.type('image/jpeg').header('Cache-Control', 'no-store')
      .header('Content-Length', image.length).send(image);
  });
}
