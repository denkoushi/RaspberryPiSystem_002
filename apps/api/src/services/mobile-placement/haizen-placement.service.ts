import { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { listScheduleRowsByProductNo } from '../part-measurement/part-measurement-schedule-lookup.service.js';
import { pickPrimaryScheduleRowForOrder, normalizeSlipToken } from './mobile-placement-slip-match.js';
import { parseStructuredShelfCode } from './mobile-placement-registered-shelves.service.js';

export type HaizenManufacturingOrderBarcodeRaw = string;

export type ApplyHaizenScanInput = {
  clientDeviceId: string;
  manufacturingOrderBarcodeRaw: HaizenManufacturingOrderBarcodeRaw;
  distributionNumber?: number | null;
  rawBarcode?: string | null;
};

export type HaizenCurrentRowDto = {
  id: string;
  manufacturingOrderBarcodeRaw: string;
  shelfCodeRaw: string;
  clientDeviceId: string;
  distributionNumber: number | null;
  csvDashboardRowId: string | null;
  productNo: string | null;
  fseiban: string | null;
  fhincd: string | null;
  fhinmei: string | null;
  updatedAt: string;
  resolutionNote: 'RESOLVED' | 'UNRESOLVED';
};

export type HaizenAssignableDeviceDto = {
  id: string;
  name: string;
  location: string | null;
  shelfCodeRaw: string | null;
  lastSeenAt: string | null;
};

const HAIZEN_RESOLVED = 'RESOLVED' as const;
const HAIZEN_UNRESOLVED = 'UNRESOLVED' as const;
const ZERO2W_DEVICE_TOKEN = 'zero2w';

function assertDistributionNumber(n: number | null | undefined): void {
  if (n === null || n === undefined) return;
  if (!Number.isInteger(n) || n < 1 || n > 999) {
    throw new ApiError(400, '分配番号は 1〜999 の整数で指定してください', undefined, 'HAIZEN_INVALID_DISTRIBUTION');
  }
}

function normalizePresetShelf(raw: string | null | undefined): string | null {
  const normalized = raw?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function isHaizenAssignableDevice(input: { apiKey: string; name: string }): boolean {
  return (
    input.apiKey.toLowerCase().includes(ZERO2W_DEVICE_TOKEN) ||
    input.name.toLowerCase().includes(ZERO2W_DEVICE_TOKEN)
  );
}

async function assertHaizenPresetShelfRegistered(raw: string): Promise<void> {
  const shelf = await prisma.mobilePlacementShelf.findUnique({
    where: { shelfCodeRaw: raw },
    select: { shelfCodeRaw: true }
  });
  if (!shelf) {
    throw new ApiError(
      400,
      'Zero2W の担当棚は棚マスタに登録済みの棚番から選択してください',
      undefined,
      'HAIZEN_PRESET_SHELF_NOT_REGISTERED'
    );
  }
}

/**
 * 端末の棚番プリセットを更新（構造化棚形式のみ）。
 */
export async function getHaizenPresetShelf(clientDeviceId: string): Promise<{ shelfCodeRaw: string | null }> {
  const device = await prisma.clientDevice.findUnique({
    where: { id: clientDeviceId },
    select: { haizenPresetShelfCodeRaw: true }
  });
  return { shelfCodeRaw: normalizePresetShelf(device?.haizenPresetShelfCodeRaw) };
}

export async function updateHaizenPresetShelf(input: {
  clientDeviceId: string;
  shelfCodeRaw: string;
}): Promise<{ shelfCodeRaw: string }> {
  const raw = input.shelfCodeRaw.trim();
  if (raw.length === 0) {
    throw new ApiError(400, '棚番が空です', undefined, 'HAIZEN_PRESET_EMPTY');
  }
  const parsed = parseStructuredShelfCode(raw);
  if (!parsed.isStructured) {
    throw new ApiError(
      400,
      '棚番は 西-北-01 の形式（エリア・列・2桁番号）で登録してください',
      undefined,
      'HAIZEN_PRESET_NOT_STRUCTURED'
    );
  }

  await assertHaizenPresetShelfRegistered(raw);

  await prisma.clientDevice.update({
    where: { id: input.clientDeviceId },
    data: { haizenPresetShelfCodeRaw: raw }
  });
  return { shelfCodeRaw: raw };
}

/**
 * Android キオスクの設定画面向け。Zero2W 候補だけを返す。
 */
export async function listHaizenAssignableDevices(): Promise<{ devices: HaizenAssignableDeviceDto[] }> {
  const rows = await prisma.clientDevice.findMany({
    where: {
      OR: [
        { apiKey: { contains: ZERO2W_DEVICE_TOKEN, mode: 'insensitive' } },
        { name: { contains: ZERO2W_DEVICE_TOKEN, mode: 'insensitive' } }
      ]
    },
    select: {
      id: true,
      name: true,
      location: true,
      apiKey: true,
      haizenPresetShelfCodeRaw: true,
      lastSeenAt: true
    },
    orderBy: [{ name: 'asc' }, { apiKey: 'asc' }]
  });

  return {
    devices: rows.map((row) => ({
      id: row.id,
      name: row.name,
      location: row.location,
      shelfCodeRaw: normalizePresetShelf(row.haizenPresetShelfCodeRaw),
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null
    }))
  };
}

/**
 * Android キオスクから、対象 Zero2W の担当棚を更新する。
 */
export async function updateHaizenPresetShelfForTarget(input: {
  clientDeviceId: string;
  shelfCodeRaw: string;
}): Promise<{ shelfCodeRaw: string }> {
  const target = await prisma.clientDevice.findUnique({
    where: { id: input.clientDeviceId },
    select: { id: true, name: true, apiKey: true }
  });
  if (!target) {
    throw new ApiError(404, '対象の Zero2W 端末が見つかりません', undefined, 'HAIZEN_TARGET_DEVICE_NOT_FOUND');
  }
  if (!isHaizenAssignableDevice(target)) {
    throw new ApiError(
      400,
      'Zero2W 端末のみ担当棚を設定できます',
      undefined,
      'HAIZEN_TARGET_DEVICE_INVALID'
    );
  }

  const raw = input.shelfCodeRaw.trim();
  await assertHaizenPresetShelfRegistered(raw);
  return updateHaizenPresetShelf({
    clientDeviceId: target.id,
    shelfCodeRaw: raw
  });
}

/**
 * Zero2W 等からの製造orderスキャンを受け、履歴追加 + 現在値 upsert。
 */
export async function applyHaizenScan(input: ApplyHaizenScanInput): Promise<{
  eventId: string;
  current: HaizenCurrentRowDto | null;
  resolutionStatus: typeof HAIZEN_RESOLVED | typeof HAIZEN_UNRESOLVED;
}> {
  assertDistributionNumber(input.distributionNumber ?? null);

  const device = await prisma.clientDevice.findUnique({
    where: { id: input.clientDeviceId },
    select: { id: true, haizenPresetShelfCodeRaw: true }
  });
  if (!device) {
    throw new ApiError(400, 'クライアント端末が不正です');
  }

  const preset = (device.haizenPresetShelfCodeRaw ?? '').trim();
  if (preset.length === 0) {
    throw new ApiError(
      400,
      '棚番プリセットが未設定です。対象端末の x-client-key で PATCH /mobile-placement/haizen-preset-shelf を実行するか、ClientDevice に設定してください',
      undefined,
      'HAIZEN_PRESET_SHELF_REQUIRED'
    );
  }

  const manufacturingOrderStored = input.manufacturingOrderBarcodeRaw.trim();
  if (manufacturingOrderStored.length === 0) {
    throw new ApiError(400, '製造order番号が空です', undefined, 'HAIZEN_ORDER_EMPTY');
  }

  const orderScan = normalizeSlipToken(input.manufacturingOrderBarcodeRaw);
  const candidates = await listScheduleRowsByProductNo(orderScan);
  const primary = pickPrimaryScheduleRowForOrder(candidates);

  let csvDashboardRowId: string | null = null;
  let scheduleSnapshot: Record<string, unknown> | null = null;
  let resolutionStatus: typeof HAIZEN_RESOLVED | typeof HAIZEN_UNRESOLVED = HAIZEN_UNRESOLVED;

  if (primary) {
    const row = await prisma.csvDashboardRow.findFirst({
      where: { id: primary.rowId },
      select: { id: true, rowData: true }
    });
    if (row) {
      csvDashboardRowId = row.id;
      const rd = (row.rowData ?? {}) as Record<string, unknown>;
      scheduleSnapshot = {
        ProductNo: rd.ProductNo ?? null,
        FSEIBAN: rd.FSEIBAN ?? null,
        FHINCD: rd.FHINCD ?? null,
        FHINMEI: rd.FHINMEI ?? null
      };
      resolutionStatus = HAIZEN_RESOLVED;
    }
  }

  const snapJson = scheduleSnapshot as Prisma.InputJsonValue | typeof Prisma.JsonNull;
  const dist =
    input.distributionNumber === null || input.distributionNumber === undefined
      ? null
      : input.distributionNumber;

  const result = await prisma.$transaction(async (tx) => {
    const ev = await tx.haizenScanEvent.create({
      data: {
        clientDeviceId: input.clientDeviceId,
        presetShelfCodeRaw: preset,
        manufacturingOrderBarcodeRaw: manufacturingOrderStored,
        distributionNumber: dist,
        rawBarcode: input.rawBarcode?.trim() || null,
        csvDashboardRowId,
        scheduleSnapshot: scheduleSnapshot ? snapJson : Prisma.JsonNull,
        resolutionStatus
      }
    });

    const upserted = await tx.haizenCurrentPlacement.upsert({
      where: { manufacturingOrderBarcodeRaw: manufacturingOrderStored },
      create: {
        manufacturingOrderBarcodeRaw: manufacturingOrderStored,
        shelfCodeRaw: preset,
        clientDeviceId: input.clientDeviceId,
        distributionNumber: dist,
        csvDashboardRowId,
        scheduleSnapshot: scheduleSnapshot ? snapJson : Prisma.JsonNull
      },
      update: {
        shelfCodeRaw: preset,
        clientDeviceId: input.clientDeviceId,
        distributionNumber: dist,
        csvDashboardRowId,
        scheduleSnapshot: scheduleSnapshot ? snapJson : Prisma.JsonNull
      }
    });

    const currentDto = toHaizenCurrentDto(upserted);

    return { eventId: ev.id, current: currentDto, resolutionStatus };
  });

  return result;
}

function toHaizenCurrentDto(row: {
  id: string;
  manufacturingOrderBarcodeRaw: string;
  shelfCodeRaw: string;
  clientDeviceId: string;
  distributionNumber: number | null;
  csvDashboardRowId: string | null;
  scheduleSnapshot: Prisma.JsonValue;
  updatedAt: Date;
}): HaizenCurrentRowDto {
  const snapUnknown = row.scheduleSnapshot;
  const snap =
    snapUnknown && typeof snapUnknown === 'object' && !Array.isArray(snapUnknown)
      ? (snapUnknown as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  const productNo = typeof snap.ProductNo === 'string' ? snap.ProductNo : null;
  const fseiban = typeof snap.FSEIBAN === 'string' ? snap.FSEIBAN : null;
  const fhincd = typeof snap.FHINCD === 'string' ? snap.FHINCD : null;
  const fhinmei = typeof snap.FHINMEI === 'string' ? snap.FHINMEI : null;

  return {
    id: row.id,
    manufacturingOrderBarcodeRaw: row.manufacturingOrderBarcodeRaw,
    shelfCodeRaw: row.shelfCodeRaw,
    clientDeviceId: row.clientDeviceId,
    distributionNumber: row.distributionNumber,
    csvDashboardRowId: row.csvDashboardRowId,
    productNo: productNo ?? row.manufacturingOrderBarcodeRaw,
    fseiban,
    fhincd,
    fhinmei,
    updatedAt: row.updatedAt.toISOString(),
    resolutionNote: row.csvDashboardRowId ? HAIZEN_RESOLVED : HAIZEN_UNRESOLVED
  };
}

/**
 * 現在の配膳一覧（棚でフィルタ可）。
 */
export async function listHaizenCurrentPlacements(input: {
  shelfCodeRaw?: string;
  limit?: number;
}): Promise<{ rows: HaizenCurrentRowDto[] }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const shelf = input.shelfCodeRaw?.trim();

  const rows = await prisma.haizenCurrentPlacement.findMany({
    where: shelf && shelf.length > 0 ? { shelfCodeRaw: shelf } : undefined,
    orderBy: { updatedAt: 'desc' },
    take: limit
  });

  return {
    rows: rows.map((r) => toHaizenCurrentDto(r))
  };
}
