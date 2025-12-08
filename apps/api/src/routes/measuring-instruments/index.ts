import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import {
  MeasuringInstrumentService,
  InspectionItemService,
  MeasuringInstrumentTagService,
  InspectionRecordService
} from '../../services/measuring-instruments/index.js';
import {
  instrumentQuerySchema,
  instrumentCreateSchema,
  instrumentUpdateSchema,
  instrumentParamsSchema,
  inspectionItemCreateSchema,
  inspectionItemUpdateSchema,
  inspectionItemParamsSchema,
  tagCreateSchema,
  tagParamsSchema,
  inspectionRecordCreateSchema,
  inspectionRecordQuerySchema,
  instrumentBorrowSchema,
  instrumentReturnSchema
} from './schemas.js';
import { MeasuringInstrumentLoanService } from '../../services/measuring-instruments/loan.service.js';
import { prisma } from '../../lib/prisma.js';

export async function registerMeasuringInstrumentRoutes(app: FastifyInstance): Promise<void> {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
  const canWrite = authorizeRoles('ADMIN', 'MANAGER');

  const instrumentService = new MeasuringInstrumentService();
  const inspectionItemService = new InspectionItemService();
  const tagService = new MeasuringInstrumentTagService();
  const inspectionRecordService = new InspectionRecordService();
  const instrumentLoanService = new MeasuringInstrumentLoanService();

  // Kiosk向け: x-client-key でも閲覧を許可する簡易認証
  const allowClientKey = async (request: FastifyRequest) => {
    // 既にJWT認証を試みる前提のフォールバックとして使用する

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

  // JWT or クライアントキー どちらかで閲覧を許可
  const allowView = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await canView(request, reply);
      return;
    } catch (error) {
      // JWT認証に失敗した場合のみクライアントキーで再判定
      await allowClientKey(request);
    }
  };

  const allowWrite = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await canWrite(request, reply);
      return;
    } catch (error) {
      await allowClientKey(request);
    }
  };

  // 計測機器一覧
  app.get('/measuring-instruments', { preHandler: allowView }, async (request) => {
    const query = instrumentQuerySchema.parse(request.query);
    const instruments = await instrumentService.findAll(query);
    return { instruments };
  });

  // 計測機器詳細
  app.get('/measuring-instruments/:id', { preHandler: allowView }, async (request) => {
    const params = instrumentParamsSchema.parse(request.params);
    const instrument = await instrumentService.findById(params.id);
    return { instrument };
  });

  // タグUIDから計測機器を取得
  app.get('/measuring-instruments/by-tag/:tagUid', { preHandler: allowView }, async (request) => {
    const params = z.object({ tagUid: z.string().min(1) }).parse(request.params);
    const tagUid = params.tagUid;
    const instrument = await instrumentService.findByTagUid(tagUid);
    if (!instrument) {
      throw new ApiError(404, '指定されたタグUIDに紐づく計測機器が見つかりません');
    }
    return { instrument };
  });

  // 計測機器作成
  app.post('/measuring-instruments', { preHandler: canWrite }, async (request) => {
    const body = instrumentCreateSchema.parse(request.body);
    const instrument = await instrumentService.create(body);
    return { instrument };
  });

  // 計測機器更新
  app.put('/measuring-instruments/:id', { preHandler: canWrite }, async (request) => {
    const params = instrumentParamsSchema.parse(request.params);
    const body = instrumentUpdateSchema.parse(request.body);
    const instrument = await instrumentService.update(params.id, body);
    return { instrument };
  });

  // 計測機器削除
  app.delete('/measuring-instruments/:id', { preHandler: canWrite }, async (request) => {
    const params = instrumentParamsSchema.parse(request.params);
    const instrument = await instrumentService.delete(params.id);
    return { instrument };
  });

  // 点検項目一覧（計測機器単位）
  app.get('/measuring-instruments/:id/inspection-items', { preHandler: allowView }, async (request) => {
    const params = instrumentParamsSchema.parse(request.params);
    const items = await inspectionItemService.findByInstrument(params.id);
    return { inspectionItems: items };
  });

  // 点検項目作成
  app.post('/measuring-instruments/:id/inspection-items', { preHandler: canWrite }, async (request) => {
    const params = instrumentParamsSchema.parse(request.params);
    const rawBody = typeof request.body === 'object' && request.body !== null ? request.body : {};
    const body = inspectionItemCreateSchema.parse({ ...rawBody, measuringInstrumentId: params.id });
    const item = await inspectionItemService.create(body);
    return { inspectionItem: item };
  });

  // 点検項目更新
  app.put('/inspection-items/:itemId', { preHandler: canWrite }, async (request) => {
    const params = inspectionItemParamsSchema.parse(request.params);
    const body = inspectionItemUpdateSchema.parse(request.body);
    const item = await inspectionItemService.update(params.itemId, body);
    return { inspectionItem: item };
  });

  // 点検項目削除
  app.delete('/inspection-items/:itemId', { preHandler: canWrite }, async (request) => {
    const params = inspectionItemParamsSchema.parse(request.params);
    const item = await inspectionItemService.delete(params.itemId);
    return { inspectionItem: item };
  });

  // RFIDタグ一覧
  app.get('/measuring-instruments/:id/tags', { preHandler: canView }, async (request) => {
    const params = instrumentParamsSchema.parse(request.params);
    const tags = await tagService.findByInstrument(params.id);
    return { tags };
  });

  // RFIDタグ紐付け作成
  app.post('/measuring-instruments/:id/tags', { preHandler: canWrite }, async (request) => {
    const params = instrumentParamsSchema.parse(request.params);
    const body = tagCreateSchema.parse(request.body);
    const tag = await tagService.create({ measuringInstrumentId: params.id, rfidTagUid: body.rfidTagUid });
    return { tag };
  });

  // RFIDタグ紐付け削除
  app.delete('/measuring-instruments/tags/:tagId', { preHandler: canWrite }, async (request) => {
    const params = tagParamsSchema.parse(request.params);
    const tag = await tagService.delete(params.tagId);
    return { tag };
  });

  // 点検記録一覧（計測機器単位）
  app.get('/measuring-instruments/:id/inspection-records', { preHandler: canView }, async (request) => {
    const params = instrumentParamsSchema.parse(request.params);
    const query = inspectionRecordQuerySchema.parse(request.query);
    const records = await inspectionRecordService.findByInstrument({
      measuringInstrumentId: params.id,
      startDate: query.startDate,
      endDate: query.endDate,
      employeeId: query.employeeId,
      result: query.result
    });
    return { inspectionRecords: records };
  });

  // 点検記録作成
  app.post('/measuring-instruments/:id/inspection-records', { preHandler: canWrite }, async (request) => {
    const params = instrumentParamsSchema.parse(request.params);
    const rawBody = typeof request.body === 'object' && request.body !== null ? request.body : {};
    const body = inspectionRecordCreateSchema.parse({ ...rawBody, measuringInstrumentId: params.id });
    const record = await inspectionRecordService.create(body);
    return { inspectionRecord: record };
  });

  // 計測機器持出
  app.post('/measuring-instruments/borrow', { preHandler: allowWrite }, async (request) => {
    const body = instrumentBorrowSchema.parse(request.body);
    const loan = await instrumentLoanService.borrow(body);
    return { loan };
  });

  // 計測機器返却
  app.post('/measuring-instruments/return', { preHandler: allowWrite }, async (request) => {
    const body = instrumentReturnSchema.parse(request.body);
    const loan = await instrumentLoanService.return(body);
    return { loan };
  });
}
