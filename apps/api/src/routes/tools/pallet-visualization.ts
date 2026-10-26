import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import {
  commandDeletePalletIllustration,
  commandUpdatePalletMachinePalletCount,
  commandUpsertPalletIllustration,
} from '../../services/pallet-visualization/pallet-visualization-command.service.js';
import { MAX_MACHINE_PALLET_COUNT } from '../../services/pallet-visualization/pallet-count-bounds.js';
import { queryPalletVisualizationBoard } from '../../services/pallet-visualization/pallet-visualization-query.service.js';
import { PalletMachineIllustrationStorage } from '../../lib/pallet-machine-illustration-storage.js';

const machineCdParamsSchema = z.object({
  machineCd: z.string().min(1),
});

export async function registerToolsPalletVisualizationRoutes(app: FastifyInstance): Promise<void> {
  const canManage = authorizeRoles('ADMIN', 'MANAGER');

  app.get('/pallet-visualization/board', { preHandler: canManage, config: { rateLimit: false } }, async () => {
    return queryPalletVisualizationBoard();
  });

  app.post(
    '/pallet-visualization/machines/:machineCd/illustration',
    { preHandler: canManage, config: { rateLimit: false } },
    async (request) => {
      const params = machineCdParamsSchema.parse(request.params);
      const data = await request.file();
      if (!data) {
        throw new ApiError(400, '画像ファイルが必要です');
      }
      const buffer = await data.toBuffer();
      const mime = data.mimetype || 'application/octet-stream';
      try {
        PalletMachineIllustrationStorage.assertMime(mime);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'サポートしていない画像形式です';
        throw new ApiError(400, message);
      }
      if (buffer.length > PalletMachineIllustrationStorage.getMaxBytes()) {
        throw new ApiError(400, '画像サイズが大きすぎます');
      }
      return commandUpsertPalletIllustration({
        machineCd: params.machineCd,
        buffer,
        mimetype: mime,
      });
    }
  );

  app.delete(
    '/pallet-visualization/machines/:machineCd/illustration',
    { preHandler: canManage, config: { rateLimit: false } },
    async (request, reply) => {
      const params = machineCdParamsSchema.parse(request.params);
      await commandDeletePalletIllustration({ machineCd: params.machineCd });
      return reply.status(204).send();
    }
  );

  const patchPalletCountBodySchema = z.object({
    palletCount: z.coerce.number().int().min(1).max(MAX_MACHINE_PALLET_COUNT),
  });

  app.patch(
    '/pallet-visualization/machines/:machineCd/pallet-count',
    { preHandler: canManage, config: { rateLimit: false } },
    async (request) => {
      const params = machineCdParamsSchema.parse(request.params);
      const body = patchPalletCountBodySchema.parse(request.body);
      await commandUpdatePalletMachinePalletCount({
        machineCd: params.machineCd,
        palletCount: body.palletCount,
      });
      return { ok: true as const };
    }
  );
}
