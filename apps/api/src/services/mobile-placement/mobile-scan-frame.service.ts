import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';
import sharp from 'sharp';
import { z } from 'zod';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { getFileStorageRuntime } from '../file-storage/file-storage-runtime.js';

const shortText = z.string().trim().min(1).max(256);
export const scanFrameBodySchema = z.object({
  clientFrameId: z.string().uuid(),
  kind: z.enum(['scan_frame', 'placement_photo']),
  clientRecordId: z.string().uuid().optional(),
  shelfCodeRaw: shortText.optional(),
  slipKind: z.enum(['manufacturing_order', 'purchase_order']).optional(),
  decodedValue: shortText.nullable(),
  manualValue: z.string().max(256).optional(),
  outcome: z.enum(['decoded', 'timeout']),
  decodeMs: z.number().int().min(0).max(2147483647),
  retryCount: z.number().int().min(0).max(2147483647),
  engine: z.enum(['native', 'zxing']),
  camera: z.record(z.string(), z.json()),
  torchOn: z.boolean().optional(),
  zoom: z.number().nonnegative().optional(),
  cropBox: z.object({ x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative() }).nullable(),
  capturedAt: z.string().datetime({ offset: true }),
  fullJpeg: z.string(),
  cropJpeg: z.string().optional()
}).superRefine((value, context) => {
  if (value.kind === 'placement_photo' && (!value.clientRecordId || !value.shelfCodeRaw)) {
    context.addIssue({ code: 'custom', message: '配置写真には記録IDと棚が必要です' });
  }
});

function decodeJpeg(encoded: string, maxBytes: number): Buffer {
  if (encoded.length > Math.ceil(maxBytes / 3) * 4) throw new ApiError(413, '写真が大きすぎます');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > maxBytes) throw new ApiError(413, '写真が大きすぎます');
  if (bytes.toString('base64') !== encoded || !bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    throw new ApiError(400, 'JPEGの形式が正しくありません');
  }
  return bytes;
}

export async function saveMobileScanFrame(input: z.infer<typeof scanFrameBodySchema>, clientDeviceId: string) {
  if (await prisma.mobileScanFrame.findUnique({ where: { clientFrameId: input.clientFrameId }, select: { id: true } })) {
    throw new ApiError(409, '保存済みです');
  }
  const { fullJpeg, cropJpeg, cropBox, camera, ...meta } = input;
  const full = decodeJpeg(fullJpeg, 600 * 1024);
  const crop = cropJpeg === undefined ? undefined : decodeJpeg(cropJpeg, 300 * 1024);
  const event = input.clientRecordId ? await prisma.orderPlacementEvent.findUnique({ where: { clientRecordId: input.clientRecordId } }) : null;
  if (input.kind === 'placement_photo' && !event) throw new ApiError(422, '配置記録がありません');
  if (event && event.clientDeviceId !== clientDeviceId) throw new ApiError(400, '配置記録の端末が一致しません');
  const id = randomUUID();
  const capturedAt = new Date(input.capturedAt);
  // Stored in the existing photos volume; the photo-loan yearly cleanup only lists photos/YYYY/01.
  const prefix = `photos/mobile-scan-frames/${capturedAt.toISOString().slice(0, 7).replace('-', '/')}/${id}`;
  const fullKey = `${prefix}-full.jpg`;
  const cropKey = crop ? `${prefix}-crop.jpg` : undefined;
  const store = getFileStorageRuntime().store;
  const writes = [{ key: fullKey, data: full, mode: 'create' as const, integrity: true }];
  if (crop && cropKey) writes.push({ key: cropKey, data: crop, mode: 'create', integrity: true });
  await store.writeBatch(writes);
  try {
    return await prisma.mobileScanFrame.create({ data: {
      ...meta, id, clientDeviceId, orderPlacementEventId: event?.id, capturedAt,
      camera: camera as Prisma.InputJsonObject, cropBox: cropBox ?? Prisma.DbNull,
      fullKey, cropKey, fullBytes: full.length, cropBytes: crop?.length
    }, select: { id: true } });
  } catch (error) {
    // Only roll back files from this failed request, never saved historical frames.
    await Promise.allSettled(writes.map(({ key }) => store.delete(key, { integrity: true })));
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ApiError(409, '保存済みです');
    throw error;
  }
}

export const placementPhotoQuerySchema = z.object({
  q: z.string().trim().max(256).optional(),
  shelf: z.string().trim().max(256).optional(),
  date: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});
export async function listPlacementPhotos(query: z.infer<typeof placementPhotoQuerySchema>) {
  const start = query.date ? new Date(`${query.date}T00:00:00+09:00`) : undefined;
  const interval = start ? { gte: start, lt: new Date(start.getTime() + 86400000) } : undefined;
  const rows = await prisma.mobileScanFrame.findMany({
    where: {
      kind: 'placement_photo', shelfCodeRaw: query.shelf || undefined,
      AND: [
        ...(query.q ? [{ OR: [
          { orderPlacementEvent: { manufacturingOrderBarcodeRaw: { contains: query.q } } },
          { orderPlacementEventId: null, decodedValue: { contains: query.q } }
        ] }] : []),
        ...(interval ? [{ OR: [
          { orderPlacementEvent: { placedAt: interval } },
          { orderPlacementEventId: null, capturedAt: interval }
        ] }] : [])
      ]
    },
    omit: { fullKey: true },
    include: { clientDevice: { select: { name: true } }, orderPlacementEvent: { select: { manufacturingOrderBarcodeRaw: true, branchNo: true, placedAt: true } } },
    orderBy: { capturedAt: 'desc' }, take: query.limit
  });
  return rows.map(({ cropKey, clientDevice, orderPlacementEvent, ...row }) => ({
    ...row, deviceName: clientDevice.name, hasCrop: Boolean(cropKey),
    number: orderPlacementEvent?.manufacturingOrderBarcodeRaw ?? row.decodedValue,
    branchNo: orderPlacementEvent?.branchNo ?? null,
    placedAt: orderPlacementEvent?.placedAt ?? row.capturedAt
  }));
}
export async function readMobileScanFrame(id: string, variant: 'crop' | 'full' | 'crop-thumb' | 'full-thumb') {
  const row = await prisma.mobileScanFrame.findUnique({ where: { id }, select: { fullKey: true, cropKey: true } });
  const key = variant.startsWith('crop') ? row?.cropKey : row?.fullKey;
  if (!key) throw new ApiError(404, '写真がありません');
  const bytes = await getFileStorageRuntime().store.read(key, { verifyIntegrity: true });
  return variant.endsWith('-thumb')
    ? sharp(bytes).resize({ width: 160, height: 160, fit: 'inside', withoutEnlargement: true }).jpeg().toBuffer()
    : bytes;
}
