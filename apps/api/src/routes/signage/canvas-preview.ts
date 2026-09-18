import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { authorizeKioskClientKeyOrJwtRoles } from '../../lib/kiosk-document-auth.js';
import { SignageRenderer } from '../../services/signage/signage.renderer.js';
import { SignageService } from '../../services/signage/index.js';
import { signageCanvasSpecSchema, toSignageCanvasLayout } from '../../services/signage/signage-canvas.js';

/** 業務Hermesの提案キャンバスを保存せずJPEG化する（閲覧権限のみ）。 */
export function registerCanvasPreviewRoute(app: FastifyInstance, signageService: SignageService): void {
  const canView = async (request: FastifyRequest, reply: FastifyReply) => {
    await authorizeKioskClientKeyOrJwtRoles(request, reply, ['ADMIN', 'MANAGER', 'VIEWER']);
  };

  app.post('/canvas-preview', { preHandler: canView }, async (request: FastifyRequest, reply: FastifyReply) => {
    const spec = signageCanvasSpecSchema.parse(request.body);
    const renderer = new SignageRenderer(signageService);
    const buffer = await renderer.renderCanvasPreviewToBuffer(toSignageCanvasLayout(spec));

    return reply
      .type('image/jpeg')
      .header('Cache-Control', 'no-store')
      .header('Content-Length', buffer.length)
      .send(buffer);
  });
}
