import {
  buildAutoDisplayLabel,
  indexToRc,
  type MacroZoneId
} from '@raspi-system/shelf-layout-core';
import type { PrismaClient } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

import { macroZoneIdForShelfCode } from './shelf-layout-edit.service.js';

type PrismaTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

async function shelfHasOperationalData(db: PrismaTx, shelfCodeRaw: string): Promise<boolean> {
  const [branchCount, haizenCount, presetCount] = await Promise.all([
    db.orderPlacementBranchState.count({ where: { shelfCodeRaw } }),
    db.haizenCurrentPlacement.count({ where: { shelfCodeRaw } }),
    db.clientDevice.count({
      where: { haizenPresetShelfCodeRaw: shelfCodeRaw, haizenEdgeEnabled: true }
    })
  ]);
  return branchCount > 0 || haizenCount > 0 || presetCount > 0;
}

async function recomputeDisplayLabelForShelf(
  db: PrismaTx,
  shelfCodeRaw: string,
  macroZoneId: MacroZoneId
): Promise<string | null> {
  const layout = await db.mobilePlacementZoneLayout.findUnique({
    where: { macroZoneId },
    include: {
      entities: {
        include: { shelf: true },
        orderBy: { createdAt: 'asc' }
      }
    }
  });
  if (!layout) {
    return null;
  }
  const gridSize = layout.gridSize === 4 ? 4 : 3;
  const asCellIndices = (value: unknown): number[] =>
    Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number' && Number.isInteger(v)) : [];
  const entity = layout.entities.find((e) => e.shelf?.shelfCodeRaw === shelfCodeRaw && e.entityKind === 'SHELF');
  if (!entity) {
    return null;
  }
  const machines = layout.entities
    .filter((e) => e.entityKind === 'MACHINE' && e.resourceName)
    .flatMap((e) => {
      const pts = asCellIndices(e.cellIndices).map((i) => indexToRc(i, gridSize));
      const r = pts.reduce((s, p) => s + p.r, 0) / pts.length;
      const c = pts.reduce((s, p) => s + p.c, 0) / pts.length;
      return [{ resourceName: e.resourceName!, r, c }];
    });
  const otherLabels = layout.entities
    .filter((e) => e.entityKind === 'SHELF' && e.shelf?.shelfCodeRaw !== shelfCodeRaw && e.shelf?.displayLabel)
    .map((e) => e.shelf!.displayLabel!);
  return buildAutoDisplayLabel({
    cellIndices: asCellIndices(entity.cellIndices),
    gridSize,
    machines,
    existingLabelsInZone: otherLabels
  });
}

export async function relocateMobilePlacementShelf(input: {
  sourceShelfCodeRaw: string;
  targetShelfCodeRaw: string;
}): Promise<{ sourceShelfCodeRaw: string; targetShelfCodeRaw: string; movedDisplayLabel: string | null }> {
  const source = input.sourceShelfCodeRaw.trim();
  const target = input.targetShelfCodeRaw.trim();
  if (source.length === 0 || target.length === 0) {
    throw new ApiError(400, '棚番が空です', undefined, 'SHELF_RELOCATE_EMPTY');
  }
  if (source === target) {
    throw new ApiError(400, '移動元と移動先が同じです', undefined, 'SHELF_RELOCATE_SAME');
  }

  let movedDisplayLabel: string | null = null;

  await prisma.$transaction(async (tx) => {
    const [sourceShelf, targetShelf] = await Promise.all([
      tx.mobilePlacementShelf.findUnique({ where: { shelfCodeRaw: source } }),
      tx.mobilePlacementShelf.findUnique({ where: { shelfCodeRaw: target } })
    ]);
    if (!sourceShelf || !targetShelf) {
      throw new ApiError(404, '棚が見つかりません', undefined, 'SHELF_RELOCATE_NOT_FOUND');
    }
    const sourceHasData = await shelfHasOperationalData(tx, source);
    if (!sourceHasData) {
      throw new ApiError(400, '移動元に稼働データがありません', undefined, 'SHELF_RELOCATE_SOURCE_EMPTY');
    }
    const targetHasData = await shelfHasOperationalData(tx, target);
    if (targetHasData) {
      throw new ApiError(409, '移動先に既に稼働データがあります', undefined, 'SHELF_RELOCATE_TARGET_OCCUPIED');
    }
    movedDisplayLabel = sourceShelf.displayLabel;

    await tx.orderPlacementBranchState.updateMany({
      where: { shelfCodeRaw: source },
      data: { shelfCodeRaw: target }
    });
    await tx.haizenCurrentPlacement.updateMany({
      where: { shelfCodeRaw: source },
      data: { shelfCodeRaw: target }
    });
    await tx.clientDevice.updateMany({
      where: { haizenPresetShelfCodeRaw: source },
      data: { haizenPresetShelfCodeRaw: target }
    });

    await tx.mobilePlacementShelf.update({
      where: { id: targetShelf.id },
      data: { displayLabel: movedDisplayLabel }
    });

    const sourceMacro = (sourceShelf.macroZoneId ?? macroZoneIdForShelfCode(source)) as MacroZoneId | null;
    const newSourceLabel =
      sourceMacro != null ? await recomputeDisplayLabelForShelf(tx, source, sourceMacro) : null;
    await tx.mobilePlacementShelf.update({
      where: { id: sourceShelf.id },
      data: { displayLabel: newSourceLabel }
    });
  });

  return { sourceShelfCodeRaw: source, targetShelfCodeRaw: target, movedDisplayLabel };
}
