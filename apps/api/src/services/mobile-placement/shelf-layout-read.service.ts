import {
  getMacroZoneById,
  type MacroZoneId
} from '@raspi-system/shelf-layout-core';
import type { MobilePlacementLayoutEntityKind, Prisma, PrismaClient } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

type PrismaTx = PrismaClient | Prisma.TransactionClient;

export type ZoneLayoutDetail = {
  macroZoneId: MacroZoneId;
  displayName: string;
  shelfPrefix: string;
  gridSize: 3 | 4;
  nextShelfSlot: number;
  updatedAt: string;
  entities: LayoutEntityDto[];
  zero2wDeviceCountByShelfCode: Record<string, number>;
};

export type LayoutEntityDto = {
  id: string;
  entityKind: MobilePlacementLayoutEntityKind;
  cellIndices: number[];
  resourceCd: string | null;
  resourceName: string | null;
  shelfCodeRaw: string | null;
  displayLabel: string | null;
  aisleLabel: string | null;
};

export type ShelfLayoutSummary = {
  macroZoneId: MacroZoneId;
  displayName: string;
  gridSize: number;
  shelfCount: number;
  machineCount: number;
  entities: LayoutEntityDto[];
};

const MACRO_ZONE_IDS: MacroZoneId[] = ['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se'];

function parseMacroZoneId(raw: string): MacroZoneId {
  if ((MACRO_ZONE_IDS as string[]).includes(raw)) {
    return raw as MacroZoneId;
  }
  throw new ApiError(400, '無効な区画 ID です', undefined, 'SHELF_LAYOUT_INVALID_ZONE');
}

function asCellIndices(value: Prisma.JsonValue): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((v): v is number => typeof v === 'number' && Number.isInteger(v));
}

function mapLayoutEntity(row: {
  id: string;
  entityKind: MobilePlacementLayoutEntityKind;
  cellIndices: Prisma.JsonValue;
  resourceCd: string | null;
  resourceName: string | null;
  aisleLabel: string | null;
  shelf: { shelfCodeRaw: string; displayLabel: string | null } | null;
}): LayoutEntityDto {
  return {
    id: row.id,
    entityKind: row.entityKind,
    cellIndices: asCellIndices(row.cellIndices),
    resourceCd: row.resourceCd,
    resourceName: row.resourceName,
    shelfCodeRaw: row.shelf?.shelfCodeRaw ?? null,
    displayLabel: row.shelf?.displayLabel ?? null,
    aisleLabel: row.aisleLabel
  };
}

async function ensureZoneLayoutsSeeded(db: PrismaTx = prisma): Promise<void> {
  const count = await db.mobilePlacementZoneLayout.count();
  if (count >= 9) {
    return;
  }
  for (const macroZoneId of MACRO_ZONE_IDS) {
    await db.mobilePlacementZoneLayout.upsert({
      where: { macroZoneId },
      create: { macroZoneId, gridSize: 3, nextShelfSlot: 1 },
      update: {}
    });
  }
}

export async function listShelfLayoutSummary(): Promise<{ zones: ShelfLayoutSummary[] }> {
  await ensureZoneLayoutsSeeded();
  const rows = await prisma.mobilePlacementZoneLayout.findMany({
    include: {
      entities: {
        include: { shelf: true },
        orderBy: { createdAt: 'asc' }
      }
    },
    orderBy: { macroZoneId: 'asc' }
  });
  const byId = new Map(rows.map((r) => [r.macroZoneId, r]));
  const zones: ShelfLayoutSummary[] = MACRO_ZONE_IDS.map((id) => {
    const row = byId.get(id);
    const meta = getMacroZoneById(id);
    const entityRows = row?.entities ?? [];
    const entities = entityRows.map((e) => mapLayoutEntity(e));
    return {
      macroZoneId: id,
      displayName: meta.displayName,
      gridSize: row?.gridSize ?? 3,
      shelfCount: entityRows.filter((e) => e.entityKind === 'SHELF').length,
      machineCount: entityRows.filter((e) => e.entityKind === 'MACHINE').length,
      entities
    };
  });
  return { zones };
}

export async function getShelfLayoutZone(macroZoneIdRaw: string): Promise<ZoneLayoutDetail> {
  await ensureZoneLayoutsSeeded();
  const macroZoneId = parseMacroZoneId(macroZoneIdRaw);
  const meta = getMacroZoneById(macroZoneId);
  const layout = await prisma.mobilePlacementZoneLayout.findUnique({
    where: { macroZoneId },
    include: {
      entities: {
        include: { shelf: true },
        orderBy: { createdAt: 'asc' }
      }
    }
  });
  if (!layout) {
    throw new ApiError(404, '区画レイアウトが見つかりません', undefined, 'SHELF_LAYOUT_ZONE_NOT_FOUND');
  }

  const presetCounts = await prisma.clientDevice.groupBy({
    by: ['haizenPresetShelfCodeRaw'],
    where: {
      haizenPresetShelfCodeRaw: { not: null },
      haizenEdgeEnabled: true
    },
    _count: { _all: true }
  });
  const zero2wDeviceCountByShelfCode: Record<string, number> = {};
  for (const row of presetCounts) {
    if (row.haizenPresetShelfCodeRaw) {
      zero2wDeviceCountByShelfCode[row.haizenPresetShelfCodeRaw] = row._count._all;
    }
  }

  return {
    macroZoneId,
    displayName: meta.displayName,
    shelfPrefix: meta.shelfPrefix,
    gridSize: layout.gridSize === 4 ? 4 : 3,
    nextShelfSlot: layout.nextShelfSlot,
    updatedAt: layout.updatedAt.toISOString(),
    zero2wDeviceCountByShelfCode,
    entities: layout.entities.map(mapLayoutEntity)
  };
}

