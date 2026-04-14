import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { z } from 'zod';
import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import {
  MeasuringInstrumentService,
  MeasuringInstrumentGenreService,
  InspectionItemService,
  MeasuringInstrumentTagService,
  InspectionRecordService,
  MeasuringInstrumentLoanAnalyticsService,
} from '../../services/measuring-instruments/index.js';
import { resolveClientDeviceId } from '../../services/clients/client-device-resolution.service.js';
import { MeasuringInstrumentGenreImageStorage } from '../../lib/measuring-instrument-genre-image-storage.js';
import {
  instrumentQuerySchema,
  instrumentCreateSchema,
  instrumentUpdateSchema,
  instrumentParamsSchema,
  genreParamsSchema,
  genreCreateSchema,
  genreUpdateSchema,
  genreImageSlotParamsSchema,
  inspectionItemCreateSchema,
  inspectionItemUpdateSchema,
  inspectionItemParamsSchema,
  tagCreateSchema,
  tagParamsSchema,
  inspectionRecordCreateSchema,
  inspectionRecordQuerySchema,
  instrumentBorrowSchema,
  instrumentReturnSchema,
  instrumentLoanAnalyticsQuerySchema,
} from './schemas.js';
import { MeasuringInstrumentLoanService } from '../../services/measuring-instruments/loan.service.js';
import { prisma } from '../../lib/prisma.js';

export async function registerMeasuringInstrumentRoutes(app: FastifyInstance): Promise<void> {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
  const canWrite = authorizeRoles('ADMIN', 'MANAGER');

  const instrumentService = new MeasuringInstrumentService();
  const genreService = new MeasuringInstrumentGenreService();
  const inspectionItemService = new InspectionItemService();
  const tagService = new MeasuringInstrumentTagService();
  const inspectionRecordService = new InspectionRecordService();
  const instrumentLoanService = new MeasuringInstrumentLoanService();
  const instrumentLoanAnalyticsService = MeasuringInstrumentLoanAnalyticsService.createDefault();

  const readSingleImageFile = async (request: FastifyRequest): Promise<MultipartFile> => {
    if (!request.isMultipart()) {
      throw new ApiError(400, 'multipart/form-data が必要です');
    }
    const file = await request.file();
    if (!file) {
      throw new ApiError(400, '画像ファイルが必要です');
    }
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      throw new ApiError(400, '画像ファイル（png/jpeg/webp）を指定してください');
    }
    return file;
  };

  // Kiosk向け: x-client-key でも閲覧を許可する簡易認証
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

  // JWT or クライアントキー どちらかで閲覧を許可
  // 注意: ブラウザが期限切れJWTを送信し続ける場合があるため、
  // JWT認証失敗時はx-client-keyへフォールバックする
  const allowView = async (request: FastifyRequest, reply: FastifyReply) => {
    // JWTトークンがある場合は通常の認証を試みる
    if (request.headers.authorization) {
      try {
        await canView(request, reply);
        return;
      } catch {
        // JWT認証失敗時はx-client-keyへフォールバック
      }
    }
    // JWTトークンがない場合、またはJWT認証失敗時はクライアントキー認証
    await allowClientKey(request);
    // JWT認証で一度401が設定されていても、クライアントキーで通った場合は200に戻す
    if (reply.statusCode === 401) {
      reply.code(200);
    }
  };

  const allowWrite = async (request: FastifyRequest, reply: FastifyReply) => {
    // JWTトークンがある場合は通常の認証を試みる
    if (request.headers.authorization) {
      try {
        await canWrite(request, reply);
        return;
      } catch {
        // JWT認証失敗時はx-client-keyへフォールバック
      }
    }
    // JWTトークンがない場合、またはJWT認証失敗時はクライアントキー認証
    await allowClientKey(request);
    // JWT認証で一度401が設定されていても、クライアントキーで通った場合は200に戻す
    if (reply.statusCode === 401) {
      reply.code(200);
    }
  };

  // 計測機器一覧
  app.get('/measuring-instruments', { preHandler: allowView }, async (request) => {
    const query = instrumentQuerySchema.parse(request.query);
    const instruments = await instrumentService.findAll(query);
    return { instruments };
  });

  // 計測機器の持出・返却集計（CSV+NFC統合）
  app.get('/measuring-instruments/loan-analytics', { preHandler: allowView }, async (request) => {
    const query = instrumentLoanAnalyticsQuerySchema.parse(request.query);
    return instrumentLoanAnalyticsService.getDashboard(query);
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

  // 計測機器ジャンル一覧
  app.get('/measuring-instrument-genres', { preHandler: allowView }, async () => {
    const genres = await genreService.findAll();
    return { genres };
  });

  // 計測機器ジャンル作成
  app.post('/measuring-instrument-genres', { preHandler: canWrite }, async (request) => {
    const body = genreCreateSchema.parse(request.body);
    const genre = await genreService.create(body);
    return { genre };
  });

  // 計測機器ジャンル更新
  app.put('/measuring-instrument-genres/:genreId', { preHandler: canWrite }, async (request) => {
    const params = genreParamsSchema.parse(request.params);
    const body = genreUpdateSchema.parse(request.body);
    const genre = await genreService.update(params.genreId, body);
    return { genre };
  });

  // 計測機器ジャンル削除
  app.delete('/measuring-instrument-genres/:genreId', { preHandler: canWrite }, async (request) => {
    const params = genreParamsSchema.parse(request.params);
    const genre = await genreService.delete(params.genreId);
    return { genre };
  });

  // 計測機器ジャンル画像アップロード（slot: 1 or 2）
  app.post('/measuring-instrument-genres/:genreId/images/:slot', { preHandler: canWrite }, async (request) => {
    const params = genreImageSlotParamsSchema.parse(request.params);
    const image = await readSingleImageFile(request);
    const buffer = await image.toBuffer();
    const saved = await MeasuringInstrumentGenreImageStorage.save(buffer, image.mimetype);
    const genre = await genreService.setImage(params.genreId, Number(params.slot) as 1 | 2, saved.relativeUrl);
    return { genre };
  });

  // 計測機器ジャンル画像クリア（slot: 1 or 2）
  app.delete('/measuring-instrument-genres/:genreId/images/:slot', { preHandler: canWrite }, async (request) => {
    const params = genreImageSlotParamsSchema.parse(request.params);
    const genre = await genreService.clearImage(params.genreId, Number(params.slot) as 1 | 2);
    return { genre };
  });

  // ジャンル単位の点検項目一覧
  app.get('/measuring-instrument-genres/:genreId/inspection-items', { preHandler: allowView }, async (request) => {
    const params = genreParamsSchema.parse(request.params);
    const items = await inspectionItemService.findByGenre(params.genreId);
    return { inspectionItems: items };
  });

  // ジャンル単位の点検項目作成
  app.post('/measuring-instrument-genres/:genreId/inspection-items', { preHandler: canWrite }, async (request) => {
    const params = genreParamsSchema.parse(request.params);
    const body = inspectionItemCreateSchema.parse(request.body);
    const item = await inspectionItemService.create({ ...body, genreId: params.genreId });
    return { inspectionItem: item };
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
    const body = inspectionItemCreateSchema.parse(request.body);
    const instrument = await instrumentService.findById(params.id);
    if (!instrument.genreId) {
      throw new ApiError(409, '計測機器ジャンルが未設定のため点検項目を登録できません');
    }
    const item = await inspectionItemService.create({ ...body, genreId: instrument.genreId });
    return { inspectionItem: item };
  });

  // キオスク向け: 点検表示プロフィール（ジャンル・点検項目・画像）
  app.get('/measuring-instruments/:id/inspection-profile', { preHandler: allowView }, async (request) => {
    const params = instrumentParamsSchema.parse(request.params);
    const instrument = await instrumentService.findById(params.id);
    if (!instrument.genreId) {
      return { genre: null, inspectionItems: [] };
    }
    const genre = await genreService.findById(instrument.genreId);
    const inspectionItems = await inspectionItemService.findByGenre(instrument.genreId);
    return { genre, inspectionItems };
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

  // RFIDタグ一覧（クライアントキーでも閲覧可）
  app.get('/measuring-instruments/:id/tags', { preHandler: allowView }, async (request) => {
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
    if (!body.instrumentTagUid && !body.instrumentId) {
      throw new ApiError(400, '計測機器が選択されていません');
    }
    const headerKey = request.headers['x-client-key'];
    const resolvedClientId = await resolveClientDeviceId(body.clientId, headerKey);
    const loan = await instrumentLoanService.borrow({ ...body, clientId: resolvedClientId });
    return { loan };
  });

  // 計測機器返却
  app.post('/measuring-instruments/return', { preHandler: allowWrite }, async (request) => {
    const body = instrumentReturnSchema.parse(request.body);
    const loan = await instrumentLoanService.return(body);
    return { loan };
  });

}
