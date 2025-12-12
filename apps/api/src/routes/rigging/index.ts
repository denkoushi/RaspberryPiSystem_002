import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import {
  RiggingGearService,
  RiggingInspectionRecordService,
  RiggingLoanService
} from '../../services/rigging/index.js';
import {
  riggingBorrowSchema,
  riggingGearCreateSchema,
  riggingGearParamsSchema,
  riggingGearQuerySchema,
  riggingGearUpdateSchema,
  riggingInspectionRecordCreateSchema,
  riggingInspectionRecordQuerySchema,
  riggingReturnSchema,
  riggingTagCreateSchema,
  riggingTagParamsSchema
} from './schemas.js';
import { prisma } from '../../lib/prisma.js';

export async function registerRiggingRoutes(app: FastifyInstance): Promise<void> {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
  const canWrite = authorizeRoles('ADMIN', 'MANAGER');

  const gearService = new RiggingGearService();
  const inspectionService = new RiggingInspectionRecordService();
  const loanService = new RiggingLoanService();

  const allowClientKey = async (request: FastifyRequest) => {
    const rawClientKey = request.headers['x-client-key'];
    let clientKey: string | undefined;
    if (typeof rawClientKey === 'string') {
      try {
        const parsed = JSON.parse(rawClientKey);
        clientKey = typeof parsed === 'string' ? parsed : rawClientKey;
      } catch {
        clientKey = rawClientKey;
      }
    } else if (Array.isArray(rawClientKey) && rawClientKey.length > 0) {
      clientKey = rawClientKey[0];
    }

    if (!clientKey) {
      throw new ApiError(401, 'クライアントキーが必要です', undefined, 'CLIENT_KEY_REQUIRED');
    }

    const client = await prisma.clientDevice.findUnique({ where: { apiKey: clientKey } });
    if (!client) {
      throw new ApiError(403, 'クライアントキーが無効です', undefined, 'CLIENT_KEY_INVALID');
    }
  };

  const allowView = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.authorization) {
      try {
        await canView(request, reply);
        return;
      } catch {
        // fall back
      }
    }
    await allowClientKey(request);
    if (reply.statusCode === 401) {
      reply.code(200);
    }
  };

  const allowWrite = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.authorization) {
      try {
        await canWrite(request, reply);
        return;
      } catch {
        // fall back
      }
    }
    await allowClientKey(request);
    if (reply.statusCode === 401) {
      reply.code(200);
    }
  };

  // 吊具一覧
  app.get('/rigging-gears', { preHandler: allowView }, async (request) => {
    const query = riggingGearQuerySchema.parse(request.query);
    const riggingGears = await gearService.findAll(query);
    return { riggingGears };
  });

  // 吊具詳細
  app.get('/rigging-gears/:id', { preHandler: allowView }, async (request) => {
    const params = riggingGearParamsSchema.parse(request.params);
    const riggingGear = await gearService.findById(params.id);
    if (!riggingGear) {
      throw new ApiError(404, '吊具が見つかりません');
    }
    return { riggingGear };
  });

  // タグUIDから吊具取得
  app.get('/rigging-gears/by-tag/:tagUid', { preHandler: allowView }, async (request) => {
    const params = z.object({ tagUid: z.string().min(1) }).parse(request.params);
    const riggingGear = await gearService.findByTagUid(params.tagUid);
    if (!riggingGear) {
      throw new ApiError(404, '指定されたタグUIDに紐づく吊具が見つかりません');
    }
    return { riggingGear };
  });

  // 作成
  app.post('/rigging-gears', { preHandler: canWrite }, async (request) => {
    const body = riggingGearCreateSchema.parse(request.body);
    const riggingGear = await gearService.create(body);
    return { riggingGear };
  });

  // 更新
  app.put('/rigging-gears/:id', { preHandler: canWrite }, async (request) => {
    const params = riggingGearParamsSchema.parse(request.params);
    const body = riggingGearUpdateSchema.parse(request.body);
    const riggingGear = await gearService.update(params.id, body);
    return { riggingGear };
  });

  // 削除
  app.delete('/rigging-gears/:id', { preHandler: canWrite }, async (request) => {
    const params = riggingGearParamsSchema.parse(request.params);
    const riggingGear = await gearService.delete(params.id);
    return { riggingGear };
  });

  // タグ登録
  app.post('/rigging-gears/:id/tags', { preHandler: canWrite }, async (request) => {
    const params = riggingGearParamsSchema.parse(request.params);
    const body = riggingTagCreateSchema.parse(request.body);
    // 既存タグを入れ替え
    await prisma.riggingGearTag.deleteMany({ where: { riggingGearId: params.id } });
    const tag = await prisma.riggingGearTag.create({
      data: { riggingGearId: params.id, rfidTagUid: body.rfidTagUid }
    });
    return { tag };
  });

  // タグ削除
  app.delete('/rigging-gear-tags/:tagId', { preHandler: canWrite }, async (request) => {
    const params = riggingTagParamsSchema.parse(request.params);
    const tag = await prisma.riggingGearTag.delete({ where: { id: params.tagId } });
    return { tag };
  });

  // 点検記録一覧（吊具単位）
  app.get('/rigging-gears/:id/inspection-records', { preHandler: allowView }, async (request) => {
    const params = riggingGearParamsSchema.parse(request.params);
    const query = riggingInspectionRecordQuerySchema.parse(request.query);
    const records = await inspectionService.findByRiggingGear(params.id, query);
    return { inspectionRecords: records };
  });

  // 点検記録作成（OK/NG + 備考のみ、見本画像はフロントで表示）
  app.post('/rigging-inspection-records', { preHandler: allowWrite }, async (request) => {
    const body = riggingInspectionRecordCreateSchema.parse(request.body);
    const record = await inspectionService.create({
      ...body,
      inspectedAt: body.inspectedAt
    });
    return { inspectionRecord: record };
  });

  // 貸出
  app.post('/rigging-gears/borrow', { preHandler: allowWrite }, async (request) => {
    const body = riggingBorrowSchema.parse(request.body);
    const loan = await loanService.borrow(body);
    return { loan };
  });

  // 返却
  app.post('/rigging-gears/return', { preHandler: allowWrite }, async (request) => {
    const body = riggingReturnSchema.parse(request.body);
    const loan = await loanService.return(body);
    return { loan };
  });
}
