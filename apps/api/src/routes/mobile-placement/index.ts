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
import { listRegisteredShelvesFromOrderPlacements } from '../../services/mobile-placement/mobile-placement-registered-shelves.service.js';
import { verifySlipMatch } from '../../services/mobile-placement/mobile-placement-verify-slip.service.js';
import type { ImageOcrMimeType } from '../../services/ocr/ports/image-ocr.port.js';

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
    if (
      (data.transferPartBarcodeRaw?.trim().length ?? 0) === 0 &&
      (data.transferFhinmeiBarcodeRaw?.trim().length ?? 0) === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'transferPartBarcodeRaw または transferFhinmeiBarcodeRaw が必要です',
        path: ['transferPartBarcodeRaw']
      });
    }
    if (data.actualOrderBarcodeRaw.trim().length === 0 && data.actualFseibanRaw.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'actualOrderBarcodeRaw または actualFseibanRaw のいずれかが必要です',
        path: ['actualOrderBarcodeRaw']
      });
    }
    if (
      (data.actualPartBarcodeRaw?.trim().length ?? 0) === 0 &&
      (data.actualFhinmeiBarcodeRaw?.trim().length ?? 0) === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'actualPartBarcodeRaw または actualFhinmeiBarcodeRaw が必要です',
        path: ['actualPartBarcodeRaw']
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
  shelfCodeRaw: z.string().min(1),
  manufacturingOrderBarcodeRaw: z.string().min(1)
});

export async function registerMobilePlacementRoutes(app: FastifyInstance): Promise<void> {
  const kioskDeps = {
    requireClientDevice
  };

  await registerMobilePlacementScheduleRoute(app, kioskDeps);

  /**
   * 登録済み棚番候補（`OrderPlacementEvent.shelfCodeRaw` の distinct + 構造化メタ）
   */
  app.get('/mobile-placement/registered-shelves', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    const shelves = await listRegisteredShelvesFromOrderPlacements();
    return { shelves };
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
    if (result.ok) {
      return { ok: true as const };
    }
    return { ok: false as const, reason: result.reason };
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
      request.log.info(
        {
          route: 'parse-actual-slip-image',
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
        fseiban: result.fseiban
      };
    }
  );

  app.post('/mobile-placement/register-order-placement', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const body = registerOrderPlacementBodySchema.parse(request.body);
    const identity = resolveCredentialIdentity(clientDevice);
    const result = await registerOrderPlacement({
      clientDeviceId: identity.clientDeviceId,
      shelfCodeRaw: body.shelfCodeRaw,
      manufacturingOrderBarcodeRaw: body.manufacturingOrderBarcodeRaw
    });
    return {
      event: {
        id: result.event.id,
        clientDeviceId: result.event.clientDeviceId,
        shelfCodeRaw: result.event.shelfCodeRaw,
        manufacturingOrderBarcodeRaw: result.event.manufacturingOrderBarcodeRaw,
        csvDashboardRowId: result.event.csvDashboardRowId,
        placedAt: result.event.placedAt
      },
      resolvedRowId: result.resolvedRowId
    };
  });

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
