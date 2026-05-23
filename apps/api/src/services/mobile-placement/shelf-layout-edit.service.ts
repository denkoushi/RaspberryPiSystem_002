import {
  allocateShelfCode,
  buildAutoDisplayLabel,
  getMacroZoneById,
  indexToRc,
  macroZoneIdFromStructured,
  shelfPrefixForMacroZone,
  type MacroZoneId
} from '@raspi-system/shelf-layout-core';
import type { MobilePlacementLayoutEntityKind, Prisma, PrismaClient } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

import { parseStructuredShelfCode } from './mobile-placement-registered-shelves.service.js';

type PrismaTx = PrismaClient | Prisma.TransactionClient;

export type LayoutEntityInput = {
  entityKind: MobilePlacementLayoutEntityKind;
  cellIndices: number[];
  resourceCd?: string | null;
  resourceName?: string | null;
  aisleLabel?: string | null;
  /** 既存 SHELF の shelfCodeRaw（再保存時） */
  shelfCodeRaw?: string | null;
};

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

export function validateLayoutEntities(entities: LayoutEntityInput[], gridSize: 3 | 4): void {
  const covered = new Set<number>();
  for (const entity of entities) {
    const maxIndex = gridSize * gridSize - 1;
    const unique = [...new Set(entity.cellIndices)].sort((a, b) => a - b);
    if (unique.length === 0) {
      throw new ApiError(400, 'セル配置が不正です', { reason: 'EMPTY_CELLS' }, 'SHELF_LAYOUT_INVALID_CELLS');
    }
    for (const idx of unique) {
      if (!Number.isInteger(idx) || idx < 0 || idx > maxIndex) {
        throw new ApiError(400, 'セル配置が不正です', { reason: 'OUT_OF_BOUNDS' }, 'SHELF_LAYOUT_INVALID_CELLS');
      }
      if (covered.has(idx)) {
        throw new ApiError(400, 'セルが重複しています', undefined, 'SHELF_LAYOUT_CELL_OVERLAP');
      }
      covered.add(idx);
    }
    const rows = unique.map((i) => indexToRc(i, gridSize).r);
    const cols = unique.map((i) => indexToRc(i, gridSize).c);
    const minR = Math.min(...rows);
    const maxR = Math.max(...rows);
    const minC = Math.min(...cols);
    const maxC = Math.max(...cols);
    const expectedCount = (maxR - minR + 1) * (maxC - minC + 1);
    if (expectedCount !== unique.length) {
      throw new ApiError(400, 'セル配置が不正です', { reason: 'NOT_RECTANGLE' }, 'SHELF_LAYOUT_INVALID_CELLS');
    }
    if (entity.entityKind === 'MACHINE' && !entity.resourceCd?.trim()) {
      throw new ApiError(400, '加工機マスタが必要です', undefined, 'SHELF_LAYOUT_MACHINE_REQUIRED');
    }
    if (entity.entityKind === 'SHELF' && entity.resourceCd) {
      throw new ApiError(400, '部品置き場に加工機 CD は指定できません', undefined, 'SHELF_LAYOUT_SHELF_RESOURCE');
    }
  }
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

export async function replaceShelfLayoutZone(input: {
  macroZoneIdRaw: string;
  gridSize: 3 | 4;
  entities: LayoutEntityInput[];
  expectedUpdatedAt?: string | null;
  clientDeviceId: string;
}): Promise<ZoneLayoutDetail> {
  const macroZoneId = parseMacroZoneId(input.macroZoneIdRaw);
  const prefix = shelfPrefixForMacroZone(macroZoneId);
  validateLayoutEntities(input.entities, input.gridSize);

  return prisma.$transaction(async (tx) => {
    await ensureZoneLayoutsSeeded(tx);
    const layout = await tx.mobilePlacementZoneLayout.findUnique({
      where: { macroZoneId },
      include: { entities: { include: { shelf: true } } }
    });
    if (!layout) {
      throw new ApiError(404, '区画レイアウトが見つかりません', undefined, 'SHELF_LAYOUT_ZONE_NOT_FOUND');
    }
    if (input.expectedUpdatedAt) {
      const expected = new Date(input.expectedUpdatedAt).getTime();
      if (layout.updatedAt.getTime() !== expected) {
        throw new ApiError(409, '他の端末が先に更新しました', undefined, 'SHELF_LAYOUT_STALE');
      }
    }

    const existingShelfByCode = new Map(
      layout.entities
        .filter((e) => e.shelf)
        .map((e) => [e.shelf!.shelfCodeRaw, e.shelf!])
    );

    const machineInputs = input.entities.filter((e) => e.entityKind === 'MACHINE');
    const machinesPreview = machineInputs.flatMap((e) => {
      if (!e.resourceName) {
        return [];
      }
      const indices = e.cellIndices;
      const pts = indices.map((i) => indexToRc(i, input.gridSize));
      const r = pts.reduce((s, p) => s + p.r, 0) / pts.length;
      const c = pts.reduce((s, p) => s + p.c, 0) / pts.length;
      return [{ resourceName: e.resourceName, r, c }];
    });

    const labelsInZone: string[] = [];
    let nextSlot = layout.nextShelfSlot;
    const shelfCreates: Array<{ shelfId: string; shelfCodeRaw: string; displayLabel: string }> = [];

    for (const entity of input.entities) {
      if (entity.entityKind === 'SHELF') {
        let shelfCodeRaw = entity.shelfCodeRaw?.trim() ?? '';
        const shelfRecord = shelfCodeRaw ? existingShelfByCode.get(shelfCodeRaw) : undefined;
        if (!shelfRecord) {
          const allocated = allocateShelfCode(prefix, nextSlot);
          nextSlot = allocated.nextShelfSlot;
          shelfCodeRaw = allocated.shelfCodeRaw;
        }
        const displayLabel = buildAutoDisplayLabel({
          cellIndices: entity.cellIndices,
          gridSize: input.gridSize,
          machines: machinesPreview,
          existingLabelsInZone: labelsInZone
        });
        labelsInZone.push(displayLabel);
        if (shelfRecord) {
          await tx.mobilePlacementShelf.update({
            where: { id: shelfRecord.id },
            data: { displayLabel, macroZoneId }
          });
          shelfCreates.push({ shelfId: shelfRecord.id, shelfCodeRaw, displayLabel });
        } else {
          const created = await tx.mobilePlacementShelf.create({
            data: {
              shelfCodeRaw,
              displayLabel,
              macroZoneId,
              createdByClientDeviceId: input.clientDeviceId
            }
          });
          shelfCreates.push({ shelfId: created.id, shelfCodeRaw, displayLabel });
        }
      }
    }

    await tx.mobilePlacementLayoutEntity.deleteMany({ where: { zoneLayoutId: layout.id } });

    const shelfQueue = [...shelfCreates];
    for (const entity of input.entities) {
      let shelfId: string | undefined;
      if (entity.entityKind === 'SHELF') {
        const matched = shelfQueue.shift();
        if (!matched) {
          throw new ApiError(400, '棚エンティティの整合性エラー', undefined, 'SHELF_LAYOUT_SHELF_MISMATCH');
        }
        shelfId = matched.shelfId;
      }
      await tx.mobilePlacementLayoutEntity.create({
        data: {
          zoneLayoutId: layout.id,
          entityKind: entity.entityKind,
          cellIndices: entity.cellIndices,
          resourceCd: entity.resourceCd ?? null,
          resourceName: entity.resourceName ?? null,
          aisleLabel: entity.aisleLabel ?? null,
          shelfId: shelfId ?? null
        }
      });
    }

    const updatedLayout = await tx.mobilePlacementZoneLayout.update({
      where: { id: layout.id },
      data: {
        gridSize: input.gridSize,
        nextShelfSlot: nextSlot
      },
      include: {
        entities: {
          include: { shelf: true },
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    const meta = getMacroZoneById(macroZoneId);
    return {
      macroZoneId,
      displayName: meta.displayName,
      shelfPrefix: meta.shelfPrefix,
      gridSize: updatedLayout.gridSize === 4 ? 4 : 3,
      nextShelfSlot: updatedLayout.nextShelfSlot,
      updatedAt: updatedLayout.updatedAt.toISOString(),
      zero2wDeviceCountByShelfCode: {},
      entities: updatedLayout.entities.map(mapLayoutEntity)
    };
  });
}

export function macroZoneIdForShelfCode(shelfCodeRaw: string): MacroZoneId | null {
  const parsed = parseStructuredShelfCode(shelfCodeRaw);
  if (!parsed.isStructured || !parsed.areaId || !parsed.lineId) {
    return null;
  }
  return macroZoneIdFromStructured(parsed.areaId, parsed.lineId);
}
