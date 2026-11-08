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
  resolveSignagePreviewTargetInput,
  setSignagePreviewTarget
} from '../../services/kiosk/kiosk-signage-preview.service.js';

const selectionBodySchema = z.union([
  z.object({ signagePreviewTargetDeviceId: z.string().guid().nullable() }).strict(),
  z.object({ signagePreviewTargetClientDeviceId: z.string().guid().nullable() }).strict(),
]);
const imageQuerySchema = z.object({ clientDeviceId: z.string().guid().optional() });

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
    const selectedClientDeviceId = resolveSignagePreviewTargetClientDeviceId(row?.signagePreviewTargetDeviceId ?? null, candidates);

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

    const input = 'signagePreviewTargetClientDeviceId' in body
      ? { signagePreviewTargetDeviceId: body.signagePreviewTargetClientDeviceId }
      : body;
    const target = await resolveSignagePreviewTargetInput(input);
    if (target.signagePreviewTargetDeviceId === null) {
      await clearSignagePreviewTarget(clientDevice.id);
    } else {
      await setSignagePreviewTarget(clientDevice.id, target.signagePreviewTargetDeviceId);
    }
    return {
      ok: true as const,
      signagePreviewTargetDeviceId: target.signagePreviewTargetDeviceId,
      signagePreviewTargetClientDeviceId: target.signagePreviewTargetDeviceId,
    };
  });

  app.get('/kiosk/signage-preview/image', async (request, reply) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const query = imageQuerySchema.parse(request.query);
    const candidates = await listSignagePreviewCandidates();
    const row = query.clientDeviceId ? null : await getSignagePreviewTarget(clientDevice.id);
    const targetId = query.clientDeviceId
      ?? resolveSignagePreviewTargetClientDeviceId(row?.signagePreviewTargetDeviceId ?? null, candidates)
      ?? clientDevice.id;
    const candidate = candidates.find((device) => device.id === targetId);
    if (targetId !== clientDevice.id && !candidate) {
      throw new ApiError(404, 'プレビュー対象のサイネージ端末が見つかりません', undefined, 'SIGNAGE_PREVIEW_TARGET_NOT_FOUND');
    }
    const image = await SignageRenderStorage.readCurrentImage(targetId)
      ?? await renderer.renderMessage('表示するコンテンツがありません');
    return reply.type('image/jpeg').header('Cache-Control', 'no-store')
      .header('Content-Length', image.length).send(image);
  });
}
