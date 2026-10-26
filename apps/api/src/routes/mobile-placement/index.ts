import { listHaizenOverview } from '../../services/mobile-placement/haizen-overview.service.js';
import { extractManufacturingOrder10 } from '../../services/mobile-placement/genpyo-slip/genpyo-mo-extract.js';
import { buildActualSlipOcrPreviewSafe } from '../../services/mobile-placement/actual-slip-ocr-preview.js';
import { getKnownFseibans } from '../../services/mobile-placement/known-fseiban-cache.js';
import { snapFseiban, type FseibanSnapResult } from '../../services/mobile-placement/genpyo-slip/fseiban-snap.js';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { ApiError } from '../../lib/errors.js';
import { requireClientDevice } from '../kiosk/shared.js';
import { resolveCredentialIdentity } from '../../lib/location-scope-resolver.js';
import { registerMobilePlacementScheduleRoute } from './schedule-list.js';
import { parseActualSlipImageFromUpload } from '../../services/mobile-placement/actual-slip-image-ocr.service.js';
import { registerPlacement, resolveItemByBarcode } from '../../services/mobile-placement/mobile-placement.service.js';
import { registerOrderPlacement } from '../../services/mobile-placement/mobile-placement-order-placement.service.js';
import {
  deleteOrderPlacementBranch,
  listOrderPlacementBranches,
  moveOrderPlacementBranch
} from '../../services/mobile-placement/order-placement-branch.service.js';
import {
  deleteMobilePlacementShelf,
  listRegisteredShelvesFromShelfMaster,
  registerMobilePlacementShelf
} from '../../services/mobile-placement/mobile-placement-shelf-master.service.js';
import {
  applyHaizenScan,
  deleteHaizenCurrentPlacement,
  getHaizenPresetShelf,
  listHaizenAssignableDevices,
  listHaizenCurrentPlacements,
  updateHaizenPresetShelf,
  updateHaizenPresetShelfForTarget
} from '../../services/mobile-placement/haizen-placement.service.js';
import { getShelfPhoto, putShelfPhoto, updateShelfMemo } from '../../services/mobile-placement/mobile-placement-shelf-photo.service.js';
import { verifySlipMatch } from '../../services/mobile-placement/mobile-placement-verify-slip.service.js';
import { suggestPartPlacementSearch } from '../../services/mobile-placement/part-search/part-search.service.js';
import {
  getClientCapabilities,
  requireShelfLayoutEditEnabled
} from '../../services/mobile-placement/client-capabilities.service.js';
import { addShelfLandmark, deleteShelfLandmark, listShelfLandmarks, requireShelfMachines } from '../../services/mobile-placement/shelf-landmark.service.js';
import { listMachineMastersForShelfLayout } from '../../services/mobile-placement/machine-master-query.service.js';
import {
  getShelfLayoutZone,
  listShelfLayoutSummary,
  replaceShelfLayoutZone
} from '../../services/mobile-placement/shelf-layout-edit.service.js';
import { relocateMobilePlacementShelf } from '../../services/mobile-placement/shelf-relocate.service.js';
import type { ImageOcrMimeType } from '../../services/ocr/ports/image-ocr.port.js';

const snapFseibanTokensBodySchema = z.object({
  tokens: z.array(z.string().min(1).max(32)).min(1).max(50),
  text: z.string().max(4000).optional()
});

const registerBodySchema = z.object({
  shelfCodeRaw: z.string().min(1),
  itemBarcodeRaw: z.string().min(1),
  csvDashboardRowId: z.string().min(1).optional().nullable()
});

const verifySlipMatchBodySchema = z
  .object({
    transferOrderBarcodeRaw: z.string().min(1),
    transferPartBarcodeRaw: z.string().optional(),
    transferFhinmeiBarcodeRaw: z.string().optional(),
    actualOrderBarcodeRaw: z.string().optional().default(''),
    actualFseibanRaw: z.string().optional().default(''),
    actualPartBarcodeRaw: z.string().optional(),
    actualFhinmeiBarcodeRaw: z.string().optional()
  })
  .superRefine((data, ctx) => {
    if (data.actualOrderBarcodeRaw.trim().length === 0 && data.actualFseibanRaw.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'actualOrderBarcodeRaw または actualFseibanRaw のいずれかが必要です',
        path: ['actualOrderBarcodeRaw']
      });
    }
  });

async function readMultipartFile(part: MultipartFile): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of part.file) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function inferImageMimeFromMimeAndFilename(mimetype: string, filename: string): ImageOcrMimeType {
  const m = mimetype.toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'image/jpeg';
  if (m.includes('png')) return 'image/png';
  if (m.includes('webp')) return 'image/webp';
  const lower = filename.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

const registerOrderPlacementBodySchema = z.object({
  branchNo: z.number().int().min(0).max(5).optional(),
  shelfCodeRaw: z.string().min(1),
  manufacturingOrderBarcodeRaw: z.string().min(1),
  slipKind: z.enum(['manufacturing_order', 'purchase_order']).default('manufacturing_order'),
  clientRecordId: z.string().max(64).guid().optional(),
  placedAt: z.string().datetime({ offset: true }).optional()
});

const moveOrderPlacementBranchBodySchema = z.object({
  shelfCodeRaw: z.string().min(1)
});

const orderPlacementBranchesQuerySchema = z.object({
  manufacturingOrder: z.string().min(1)
});

const partSearchSuggestQuerySchema = z.object({
  q: z.string().max(100).optional().default(''),
  /** 登録製番ボタン下段の機種名（MH/SH 行 FHINMEI 由来）で AND 絞り込み。空なら無視。 */
  machineName: z.string().max(200).optional().default('')
});

const registerMobilePlacementShelfBodySchema = z.object({
  displayLabel: z.string().trim().max(60).nullable().optional(),
  shelfCodeRaw: z.string().min(1).max(200)
});

const haizenScanBodySchema = z.object({
  manufacturingOrderBarcodeRaw: z.string().min(1),
  distributionNumber: z.number().int().min(1).max(999).optional().nullable(),
  rawBarcode: z.string().max(500).optional().nullable()
});

const haizenPresetShelfBodySchema = z.object({
  /** 構造化棚番。`null` で担当棚を解除する */
  shelfCodeRaw: z.string().min(1).max(200).nullable()
});

const haizenCurrentQuerySchema = z
  .object({
    /** @deprecated 内部名に合わせて `shelfCodeRaw` を推奨 */
    shelfCode: z.string().max(200).optional(),
    shelfCodeRaw: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional()
  })
  .transform((q) => {
    const combined = (q.shelfCodeRaw ?? q.shelfCode)?.trim();
    return {
      shelfCodeRaw: combined && combined.length > 0 ? combined : undefined,
      limit: q.limit
    };
  });

const haizenTargetDeviceParamsSchema = z.object({
  clientDeviceId: z.string().min(1)
});

const shelfLayoutZoneParamsSchema = z.object({
  macroZoneId: z.enum(['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se'])
});

const shelfLayoutEntitySchema = z.object({
  entityKind: z.enum(['MACHINE', 'SHELF', 'AISLE', 'UNUSED']),
  cellIndices: z.array(z.number().int().min(0).max(15)).min(1),
  resourceCd: z.string().max(100).optional().nullable(),
  resourceName: z.string().max(200).optional().nullable(),
  aisleLabel: z.string().max(100).optional().nullable(),
  shelfCodeRaw: z.string().max(200).optional().nullable()
});

const replaceShelfLayoutZoneBodySchema = z.object({
  gridSize: z.union([z.literal(3), z.literal(4)]),
  expectedUpdatedAt: z.string().datetime().optional().nullable(),
  entities: z.array(shelfLayoutEntitySchema)
});

const relocateShelfParamsSchema = z.object({
  shelfCodeRaw: z.string().min(1)
});

const relocateShelfBodySchema = z.object({
  targetShelfCodeRaw: z.string().min(1).max(200)
});

export async function registerMobilePlacementRoutes(app: FastifyInstance): Promise<void> {
  const kioskDeps = {
    requireClientDevice
  };

  await registerMobilePlacementScheduleRoute(app, kioskDeps);

  /**
   * 登録済み棚番候補（`MobilePlacementShelf` + 構造化メタ）
   */
  app.get('/mobile-placement/registered-shelves', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    const shelves = await listRegisteredShelvesFromShelfMaster();
    return { shelves };
  });

  app.get('/mobile-placement/client-capabilities', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const identity = resolveCredentialIdentity(clientDevice);
    return getClientCapabilities(identity.clientDeviceId);
  });

  app.get('/mobile-placement/shelf-machines', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    const [machines, landmarks] = await Promise.all([requireShelfMachines(), listShelfLandmarks()]);
    return { machines, landmarks };
  });

  app.post('/mobile-placement/shelf-landmarks', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const { name } = z.object({ name: z.string() }).parse(request.body);
    return addShelfLandmark(name, resolveCredentialIdentity(clientDevice).clientDeviceId);
  });

  app.delete('/mobile-placement/shelf-landmarks/:name', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    const { name } = z.object({ name: z.string().min(1) }).parse(request.params);
    return deleteShelfLandmark(name);
  });

  app.get('/mobile-placement/machine-masters', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    return listMachineMastersForShelfLayout();
  });

  app.get('/mobile-placement/shelf-layout', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    return listShelfLayoutSummary();
  });

  app.get('/mobile-placement/shelf-layout/zones/:macroZoneId', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    const params = shelfLayoutZoneParamsSchema.parse(request.params);
    return getShelfLayoutZone(params.macroZoneId);
  });

  app.put('/mobile-placement/shelf-layout/zones/:macroZoneId', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const identity = resolveCredentialIdentity(clientDevice);
    await requireShelfLayoutEditEnabled(identity.clientDeviceId);
    const params = shelfLayoutZoneParamsSchema.parse(request.params);
    const body = replaceShelfLayoutZoneBodySchema.parse(request.body);
    return replaceShelfLayoutZone({
      macroZoneIdRaw: params.macroZoneId,
      gridSize: body.gridSize,
      entities: body.entities,
      expectedUpdatedAt: body.expectedUpdatedAt ?? null,
      clientDeviceId: identity.clientDeviceId
    });
  });

  app.post('/mobile-placement/shelves/:shelfCodeRaw/relocate', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    const params = relocateShelfParamsSchema.parse(request.params);
    const body = relocateShelfBodySchema.parse(request.body);
    return relocateMobilePlacementShelf({
      sourceShelfCodeRaw: decodeURIComponent(params.shelfCodeRaw),
      targetShelfCodeRaw: body.targetShelfCodeRaw
    });
  });

  /**
   * Zero2W 棚番エッジ: 端末に紐づく棚番プリセットの取得
   */
  app.get('/mobile-placement/haizen-preset-shelf', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const identity = resolveCredentialIdentity(clientDevice);
    return getHaizenPresetShelf(identity.clientDeviceId);
  });

  /**
   * Zero2W 棚番エッジ: 棚番プリセットの更新（構造化棚形式）
   */
  app.patch('/mobile-placement/haizen-preset-shelf', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const body = haizenPresetShelfBodySchema.parse(request.body);
    const identity = resolveCredentialIdentity(clientDevice);
    return updateHaizenPresetShelf({
      clientDeviceId: identity.clientDeviceId,
      shelfCodeRaw: body.shelfCodeRaw
    });
  });

  /**
   * Zero2W 棚番エッジ: 製造orderスキャン受付（履歴 + 現在値 upsert）
   */
  app.post('/mobile-placement/haizen-scans', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const body = haizenScanBodySchema.parse(request.body);
    const identity = resolveCredentialIdentity(clientDevice);
    const result = await applyHaizenScan({
      clientDeviceId: identity.clientDeviceId,
      manufacturingOrderBarcodeRaw: body.manufacturingOrderBarcodeRaw,
      distributionNumber: body.distributionNumber ?? undefined,
      rawBarcode: body.rawBarcode ?? undefined
    });
    return {
      eventId: result.eventId,
      resolutionStatus: result.resolutionStatus,
      current: result.current
    };
  });

  /** キオスク: Android配膳の枝ごとの現在棚と機種名。 */
  app.get('/mobile-placement/haizen-overview', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    return listHaizenOverview();
  });

  /**
   * 配膳スマホ等: 棚番配膳の現在値一覧（棚でフィルタ可）
   */
  app.get('/mobile-placement/haizen-current', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    const q = haizenCurrentQuerySchema.parse(request.query);
    return listHaizenCurrentPlacements({
      shelfCodeRaw: q.shelfCodeRaw,
      limit: q.limit
    });
  });

  /**
   * Android キオスク: Zero2W 候補端末一覧
   */
  app.get('/mobile-placement/haizen-target-devices', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    return listHaizenAssignableDevices();
  });

  /**
   * Android キオスク: 対象 Zero2W の担当棚を更新
   */
  app.put(
    '/mobile-placement/haizen-target-devices/:clientDeviceId/preset-shelf',
    { config: { rateLimit: false } },
    async (request) => {
      await requireClientDevice(request.headers['x-client-key']);
      const body = haizenPresetShelfBodySchema.parse(request.body);
      const params = haizenTargetDeviceParamsSchema.parse(request.params);
      return updateHaizenPresetShelfForTarget({
        clientDeviceId: params.clientDeviceId,
        shelfCodeRaw: body.shelfCodeRaw
      });
    }
  );

  /**
   * 棚マスタへ棚番を新規登録（配膳トップの `+`）。`西-北-01` 形式のみ。
   */
  app.post('/mobile-placement/shelves', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const body = registerMobilePlacementShelfBodySchema.parse(request.body);
    const identity = resolveCredentialIdentity(clientDevice);
    const result = await registerMobilePlacementShelf({
      clientDeviceId: identity.clientDeviceId,
      shelfCodeRaw: body.shelfCodeRaw,
      displayLabel: body.displayLabel
    });
    return { shelf: result.shelf };
  });

  app.put('/mobile-placement/shelves/:shelfCodeRaw/photo', { bodyLimit: 1_500_000, config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const { shelfCodeRaw } = z.object({ shelfCodeRaw: z.string().min(1) }).parse(request.params);
    const body = z.object({
      contentType: z.enum(['image/jpeg', 'image/webp', 'image/png']),
      dataBase64: z.string().min(1).max(1_398_104)
    }).parse(request.body);
    return putShelfPhoto(shelfCodeRaw, body, resolveCredentialIdentity(clientDevice).clientDeviceId);
  });

  app.get('/mobile-placement/shelves/:shelfCodeRaw/photo', { config: { rateLimit: false } }, async (request, reply) => {
    await requireClientDevice(request.headers['x-client-key']);
    const { shelfCodeRaw } = z.object({ shelfCodeRaw: z.string().min(1) }).parse(request.params);
    const photo = await getShelfPhoto(shelfCodeRaw);
    return reply.type(photo.contentType).header('Cache-Control', 'private, max-age=31536000, immutable').send(Buffer.from(photo.bytes));
  });

  app.delete('/mobile-placement/shelves/:shelfCodeRaw', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    const { shelfCodeRaw } = z.object({ shelfCodeRaw: z.string().min(1) }).parse(request.params);
    return deleteMobilePlacementShelf(shelfCodeRaw);
  });

  app.patch('/mobile-placement/shelves/:shelfCodeRaw', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    const { shelfCodeRaw } = z.object({ shelfCodeRaw: z.string().min(1) }).parse(request.params);
    const { displayLabel } = z.object({ displayLabel: z.string().trim().max(60).nullable() }).parse(request.body);
    return updateShelfMemo(shelfCodeRaw, displayLabel);
  });

  /**
   * 部品名検索（現在棚優先・生産スケジュール補助・同義語辞書）
   */
  app.get('/mobile-placement/part-search/suggest', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    const q = partSearchSuggestQuerySchema.parse(request.query);
    return suggestPartPlacementSearch({ q: q.q, machineName: q.machineName });
  });

  /**
   * 製造orderに紐づく分配枝の現在棚一覧（`OrderPlacementBranchState`）
   */
  app.get('/mobile-placement/order-placement-branches', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    const q = orderPlacementBranchesQuerySchema.parse(request.query);
    const branches = await listOrderPlacementBranches(q.manufacturingOrder);
    return {
      branches: branches.map((b) => ({
        id: b.id,
        manufacturingOrderBarcodeRaw: b.manufacturingOrderBarcodeRaw,
        branchNo: b.branchNo,
        shelfCodeRaw: b.shelfCodeRaw,
        csvDashboardRowId: b.csvDashboardRowId,
        updatedAt: b.updatedAt.toISOString()
      }))
    };
  });

  app.get('/mobile-placement/resolve-item', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    const q = request.query as { barcode?: string };
    const barcode = typeof q.barcode === 'string' ? q.barcode : '';
    const result = await resolveItemByBarcode(barcode);
    return result;
  });

  app.post('/mobile-placement/verify-slip-match', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    const body = verifySlipMatchBodySchema.parse(request.body);
    const result = await verifySlipMatch({
      transferOrderBarcodeRaw: body.transferOrderBarcodeRaw,
      transferPartBarcodeRaw: body.transferPartBarcodeRaw?.trim() || body.transferFhinmeiBarcodeRaw?.trim() || '',
      actualOrderBarcodeRaw: body.actualOrderBarcodeRaw,
      actualFseibanRaw: body.actualFseibanRaw,
      actualPartBarcodeRaw: body.actualPartBarcodeRaw?.trim() || body.actualFhinmeiBarcodeRaw?.trim() || ''
    });
    return result;
  });

  /**
   * 現品票の撮影画像から OCR し、製造order（10桁）と製番（FSEIBAN）候補を返す（副作用なし）。
   */
  app.post(
    '/mobile-placement/parse-actual-slip-image',
    { config: { rateLimit: false } },
    async (request: FastifyRequest) => {
      await requireClientDevice(request.headers['x-client-key']);
      if (!request.isMultipart()) {
        throw new ApiError(
          400,
          'multipart/form-data が必要です',
          undefined,
          'MOBILE_PLACEMENT_MULTIPART_REQUIRED'
        );
      }
      let fileBuffer: Buffer | null = null;
      let mime = '';
      let filename = '';
      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'image') {
          fileBuffer = await readMultipartFile(part as MultipartFile);
          mime = part.mimetype;
          filename = part.filename || '';
        }
      }
      if (!fileBuffer) {
        throw new ApiError(400, '画像ファイルが必要です', undefined, 'MOBILE_PLACEMENT_IMAGE_REQUIRED');
      }
      const imageMime = inferImageMimeFromMimeAndFilename(mime, filename);
      const result = await parseActualSlipImageFromUpload({
        imageBytes: fileBuffer,
        mimeType: imageMime,
        requestId: request.id
      });
      let snap: FseibanSnapResult = { match: 'none', fseiban: null, candidates: [] };
      try {
        const known = await getKnownFseibans();
        snap = snapFseiban(result.fseibanOcrTokens, known);
      } catch {
        request.log.warn({ route: 'parse-actual-slip-image' }, 'FSEIBAN lookup unavailable; using OCR result');
      }
      request.log.info(
        {
          route: 'parse-actual-slip-image',
          fseibanMatch: snap.match,
          fseibanCandidateCount: snap.candidates.length,
          ocrTextChars: result.ocrText.length,
          hasManufacturingOrder10: result.manufacturingOrder10 != null,
          hasFseiban: result.fseiban != null,
          engine: result.engine
        },
        'parse-actual-slip-image completed'
      );
      return {
        engine: result.engine,
        ocrText: result.ocrText,
        ocrPreviewSafe: result.ocrPreviewSafe,
        manufacturingOrder10: result.manufacturingOrder10,
        fseibanRaw: result.fseiban,
        fseibanMatch: snap.match,
        fseibanCandidates: snap.candidates,
        fseiban: snap.fseiban ?? result.fseiban
      };
    }
  );

  app.post('/mobile-placement/snap-fseiban-tokens', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    const body = snapFseibanTokensBodySchema.parse(request.body);
    const ocrText = body.text ?? '';
    const manufacturingOrder10 = extractManufacturingOrder10(ocrText);
    const fseibanRaw = body.tokens[0];
    let snap: FseibanSnapResult = { match: 'none', fseiban: null, candidates: [] };
    try {
      snap = snapFseiban(body.tokens, await getKnownFseibans());
    } catch {
      request.log.warn({ route: 'snap-fseiban-tokens' }, 'FSEIBAN lookup unavailable; using OCR result');
    }
    return {
      engine: 'device',
      ocrText,
      ocrPreviewSafe: buildActualSlipOcrPreviewSafe(manufacturingOrder10 ?? '', fseibanRaw),
      manufacturingOrder10,
      fseibanRaw,
      fseibanMatch: snap.match,
      fseibanCandidates: snap.candidates,
      fseiban: snap.fseiban ?? fseibanRaw
    };
  });

  app.post('/mobile-placement/register-order-placement', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const body = registerOrderPlacementBodySchema.parse(request.body);
    const identity = resolveCredentialIdentity(clientDevice);
    const result = await registerOrderPlacement({
      clientDeviceId: identity.clientDeviceId,
      shelfCodeRaw: body.shelfCodeRaw,
      manufacturingOrderBarcodeRaw: body.manufacturingOrderBarcodeRaw,
      slipKind: body.slipKind,
      clientRecordId: body.clientRecordId,
      placedAt: body.placedAt,
      branchNo: body.branchNo
    });
    return {
      event: {
        id: result.event.id,
        clientDeviceId: result.event.clientDeviceId,
        shelfCodeRaw: result.event.shelfCodeRaw,
        manufacturingOrderBarcodeRaw: result.event.manufacturingOrderBarcodeRaw,
        csvDashboardRowId: result.event.csvDashboardRowId,
        branchNo: result.event.branchNo,
        actionType: result.event.actionType,
        placedAt: result.event.placedAt
      },
      branchState: {
        id: result.branchState.id,
        branchNo: result.branchState.branchNo,
        shelfCodeRaw: result.branchState.shelfCodeRaw
      },
      resolvedRowId: result.resolvedRowId,
      action: result.action
    };
  });

  app.delete(
    '/mobile-placement/order-placement-branches/:id',
    { config: { rateLimit: false } },
    async (request) => {
      await requireClientDevice(request.headers['x-client-key']);
      const params = request.params as { id?: string };
      const branchStateId = typeof params.id === 'string' ? params.id.trim() : '';
      if (branchStateId.length === 0) throw new ApiError(400, '分配枝IDが必要です');
      return { deleted: await deleteOrderPlacementBranch(branchStateId) };
    }
  );

  app.delete(
    '/mobile-placement/haizen-current/:id',
    { config: { rateLimit: false } },
    async (request) => {
      await requireClientDevice(request.headers['x-client-key']);
      const params = request.params as { id?: string };
      const id = typeof params.id === 'string' ? params.id.trim() : '';
      if (id.length === 0) throw new ApiError(400, '配膳記録IDが必要です');
      return { deleted: await deleteHaizenCurrentPlacement(id) };
    }
  );

  /** 既存分配枝の棚更新（移動） */
  app.patch(
    '/mobile-placement/order-placement-branches/:id/move',
    { config: { rateLimit: false } },
    async (request) => {
      const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
      const params = request.params as { id?: string };
      const branchStateId = typeof params.id === 'string' ? params.id : '';
      if (branchStateId.length === 0) {
        throw new ApiError(400, '分配枝IDが必要です');
      }
      const body = moveOrderPlacementBranchBodySchema.parse(request.body);
      const identity = resolveCredentialIdentity(clientDevice);
      const result = await moveOrderPlacementBranch({
        clientDeviceId: identity.clientDeviceId,
        branchStateId,
        shelfCodeRaw: body.shelfCodeRaw
      });
      return {
        event: {
          id: result.event.id,
          clientDeviceId: result.event.clientDeviceId,
          shelfCodeRaw: result.event.shelfCodeRaw,
          manufacturingOrderBarcodeRaw: result.event.manufacturingOrderBarcodeRaw,
          csvDashboardRowId: result.event.csvDashboardRowId,
          branchNo: result.event.branchNo,
          actionType: result.event.actionType,
          placedAt: result.event.placedAt
        },
        branchState: {
          id: result.branchState.id,
          branchNo: result.branchState.branchNo,
          shelfCodeRaw: result.branchState.shelfCodeRaw,
          updatedAt: result.branchState.updatedAt.toISOString()
        }
      };
    }
  );

  app.post('/mobile-placement/register', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const body = registerBodySchema.parse(request.body);
    const identity = resolveCredentialIdentity(clientDevice);
    const result = await registerPlacement({
      clientDeviceId: identity.clientDeviceId,
      shelfCodeRaw: body.shelfCodeRaw,
      itemBarcodeRaw: body.itemBarcodeRaw,
      csvDashboardRowId: body.csvDashboardRowId ?? undefined
    });
    return {
      event: {
        id: result.event.id,
        clientDeviceId: result.event.clientDeviceId,
        shelfCodeRaw: result.event.shelfCodeRaw,
        itemBarcodeRaw: result.event.itemBarcodeRaw,
        itemId: result.event.itemId,
        csvDashboardRowId: result.event.csvDashboardRowId,
        previousStorageLocation: result.event.previousStorageLocation,
        newStorageLocation: result.event.newStorageLocation,
        placedAt: result.event.placedAt
      },
      item: result.item,
      resolveMatchKind: result.resolveMatchKind
    };
  });
}
