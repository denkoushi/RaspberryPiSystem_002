import { aggregateInventoryDashboard, dashboardPeriod } from './inventory-dashboard.js';
import { Prisma, PrismaClient, InventoryImportPayloadStatus, InventoryNfcTagKind } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';
import { normalizeInventoryArea, normalizeInventoryUnit } from './inventory-area.js';
import { UNIT_NAME_MAX_LENGTH, COMPARTMENT_LOOKUP_INCLUDE, TRANSACTION_INCLUDE, positiveInteger, locationDto, assertNfcUidAvailable, runSerializable, resolveUnit } from './item-inventory.helpers.js';
import { INVENTORY_OPTION_FIELDS, TOOL_FIELD_VALUE_MAX_LENGTH } from './item-inventory.fields.js';
import type { InventoryOptionField } from './item-inventory.fields.js';
import { InventoryConflictError } from './item-inventory.errors.js';

export async function resolveTag(db: PrismaClient, uid: string) {
  const tag = await db.inventoryNfcTag.findUnique({
    where: { uid: uid.trim() },
    include: {
      compartment: { include: COMPARTMENT_LOOKUP_INCLUDE },
    },
  });
  if (!tag) return null;
  return {
    id: tag.id,
    uid: tag.uid,
    kind: tag.kind,
    quantity: tag.quantity,
    compartment: tag.compartment ? locationDto(tag.compartment) : null,
  };
}

export async function resolveCompartmentByLabelNumber(db: PrismaClient, labelNumber: number) {
  const compartment = await db.inventoryCompartment.findUnique({
    where: { labelNumber },
    include: COMPARTMENT_LOOKUP_INCLUDE,
  });
  if (!compartment || compartment.inventoryItem.deletedAt) throw new ApiError(404, '在庫区画が見つかりません');
  return {
    id: compartment.itemTag?.id ?? compartment.id,
    uid: compartment.itemTag?.uid ?? '',
    kind: InventoryNfcTagKind.ITEM,
    quantity: null,
    compartment: locationDto(compartment),
  };
}

export async function listTags(db: PrismaClient) {
  const tags = await db.inventoryNfcTag.findMany({
    orderBy: [{ kind: 'asc' }, { uid: 'asc' }],
    include: {
      compartment: {
        include: { drawer: { include: { shelf: true } }, inventoryItem: true, itemTag: true },
      },
    },
  });
  return tags.map((tag) => ({
    ...tag,
    compartment: tag.compartment ? locationDto(tag.compartment) : null,
  }));
}

export async function listLocations(db: PrismaClient) {
  const shelves = await db.inventoryShelf.findMany({
    orderBy: [{ area: 'asc' }, { shelfNumber: 'asc' }],
    include: {
      drawers: {
        orderBy: { drawerNumber: 'asc' },
        include: {
          compartments: {
            orderBy: { createdAt: 'asc' },
            include: { inventoryItem: true, itemTag: true },
          },
        },
      },
    },
  });
  return shelves.map((shelf) => ({
    ...shelf,
    drawers: shelf.drawers.map(({ compartments, ...drawer }) => ({
      ...drawer,
      shelf: { area: shelf.area, shelfNumber: shelf.shelfNumber },
      compartments: compartments.map((compartment) => locationDto({
        ...compartment,
        drawer: { ...drawer, shelf: { area: shelf.area, shelfNumber: shelf.shelfNumber } },
      })),
    })),
  }));
}

export async function listItems(db: PrismaClient) {
  const items = await db.inventoryItem.findMany({
    where: { deletedAt: null },
    orderBy: [{ name: 'asc' }, { itemCode: 'asc' }],
    include: {
      photos: {
        orderBy: [{ photoIndex: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, inventoryItemId: true, photoUrl: true, originalFilename: true, photoIndex: true, createdAt: true },
      },
      compartments: {
        include: { drawer: { include: { shelf: true } }, itemTag: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
  });
  return items.map(({ compartments, ...item }) => ({
    ...item,
    compartments: compartments.map((compartment) => ({
      ...locationDto({ ...compartment, inventoryItem: item }),
      lastIssuedAt: compartment.lastIssuedAt?.toISOString() ?? null,
    })),
  }));
}

export async function deleteItem(db: PrismaClient, itemId: string) {
  return db.$transaction(async (tx) => {
    const item = await tx.inventoryItem.findUnique({ where: { id: itemId } });
    if (!item) throw new ApiError(404, '登録済みアイテムが見つかりません');
    if (item.deletedAt) throw new ApiError(409, 'このアイテムは既に削除されています');

    const compartments = await tx.inventoryCompartment.findMany({
      where: { inventoryItemId: itemId },
      select: { id: true },
    });
    const compartmentIds = compartments.map(({ id }) => id);
    if (compartmentIds.length > 0) {
      // Only item tags point at these compartments. Quantity/restock tags
      // have no compartmentId and therefore remain untouched.
      await tx.inventoryNfcTag.updateMany({
        where: { compartmentId: { in: compartmentIds } },
        data: { compartmentId: null },
      });
      await tx.inventoryCompartment.deleteMany({ where: { inventoryItemId: itemId } });
    }
    await tx.inventoryItem.update({ where: { id: itemId }, data: { deletedAt: new Date() } });
    return { id: itemId };
  });
}

export async function deleteDrawer(db: PrismaClient, id: string) {
  return runSerializable(db, async (tx) => {
    // Parent row locks also block concurrent child creation through the FK.
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "InventoryDrawer" WHERE "id" = ${id} FOR UPDATE`);
    const drawer = await tx.inventoryDrawer.findUnique({ where: { id }, include: { _count: { select: { compartments: true } } } });
    if (!drawer) throw new ApiError(404, '引き出しが見つかりません');
    if (drawer._count.compartments > 0) throw new InventoryConflictError('品物が入っている引き出しは削除できません');
    await tx.inventoryDrawer.delete({ where: { id } });
    return { id };
  });
}

export async function deleteShelf(db: PrismaClient, id: string) {
  return runSerializable(db, async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "InventoryShelf" WHERE "id" = ${id} FOR UPDATE`);
    const shelf = await tx.inventoryShelf.findUnique({ where: { id }, include: { _count: { select: { drawers: true } } } });
    if (!shelf) throw new ApiError(404, '棚が見つかりません');
    if (shelf._count.drawers > 0) throw new InventoryConflictError('引き出しがある棚は削除できません');
    await tx.inventoryShelf.delete({ where: { id } });
    return { id };
  });
}

export async function deleteTag(db: PrismaClient, id: string) {
  return runSerializable(db, async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "InventoryNfcTag" WHERE "id" = ${id} FOR UPDATE`);
    const tag = await tx.inventoryNfcTag.findUnique({ where: { id } });
    if (!tag) throw new ApiError(404, 'タグが見つかりません');
    if (tag.kind === InventoryNfcTagKind.ITEM || tag.compartmentId) {
      throw new InventoryConflictError('アイテムタグは削除できません。タグ交換を使ってください');
    }
    // InventoryTransaction.quantityTagId is a historical scalar, not a foreign key.
    await tx.inventoryNfcTag.delete({ where: { id } });
    return { id };
  });
}

export async function dismissImport(db: PrismaClient, id: string) {
  return changeImportStatus(db, id, InventoryImportPayloadStatus.PENDING, InventoryImportPayloadStatus.DISMISSED);
}

export async function restoreImport(db: PrismaClient, id: string) {
  return changeImportStatus(db, id, InventoryImportPayloadStatus.DISMISSED, InventoryImportPayloadStatus.PENDING);
}

export async function changeImportStatus(db: PrismaClient, id: string, expectedStatus: InventoryImportPayloadStatus, status: InventoryImportPayloadStatus) {
  return runSerializable(db, async (tx) => {
    const payload = await tx.inventoryImportPayload.findUnique({ where: { id }, select: { id: true } });
    if (!payload) throw new ApiError(404, 'インポート候補が見つかりません');
    const updated = await tx.inventoryImportPayload.updateMany({ where: { id, status: expectedStatus }, data: { status } });
    if (updated.count !== 1) throw new InventoryConflictError('この候補の状態が変わっています');
    return { id, status };
  });
}

export async function listPendingImports(db: PrismaClient) {
  return db.inventoryImportPayload.findMany({
    where: { status: InventoryImportPayloadStatus.PENDING },
    orderBy: { createdAt: 'asc' },
    include: { photos: { orderBy: { photoIndex: 'asc' } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
}

/** Pending candidates for the kiosk item list: newest first, one thumbnail each, no manifest or mail details. */
export async function listPendingImportSummaries(db: PrismaClient) {
  const payloads = await db.inventoryImportPayload.findMany({
    where: { status: InventoryImportPayloadStatus.PENDING },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      sourceItemId: true,
      area: true,
      category: true,
      createdAt: true,
      photos: { orderBy: { photoIndex: 'asc' }, take: 1, select: { photoUrl: true } },
      _count: { select: { photos: true } },
    },
  });
  return payloads.map(({ photos, _count, ...payload }) => ({
    ...payload,
    photoUrl: photos[0]?.photoUrl ?? null,
    photoCount: _count.photos,
  }));
}

export async function setImportMessageDismissed(db: PrismaClient, id: string, dismissed: boolean) {
  const record = await db.inventoryImportMessage.findUnique({ where: { id } });
  if (!record) throw new ApiError(404, '取込記録が見つかりません');
  return db.inventoryImportMessage.update({ where: { id }, data: { dismissedAt: dismissed ? new Date() : null } });
}

export async function listImportMessages(db: PrismaClient) {
  return db.inventoryImportMessage.findMany({ where: { dismissedAt: null }, orderBy: { updatedAt: 'desc' }, take: 100 });
}

export async function listHistory(db: PrismaClient, limit = 100, filter: { compartmentId?: string } = {}) {
  return db.inventoryTransaction.findMany({
    where: filter.compartmentId ? { compartmentId: filter.compartmentId } : undefined,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(Math.max(limit, 1), 500),
    include: TRANSACTION_INCLUDE,
  });
}

export async function dashboard(db: PrismaClient, weeks: number, machine?: string, now = new Date()) {
  const period = dashboardPeriod(weeks, now);
  const [items, issues] = await Promise.all([
    db.inventoryItem.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, toolName: true, maker: true, unit: true, unitPrice: true,
        compartments: { select: { labelNumber: true, stockQuantity: true, drawer: { select: { shelf: { select: { area: true } } } } } } },
    }),
    db.inventoryTransaction.findMany({
      where: { action: 'ISSUE', createdAt: { gte: period.previousStart, lte: period.end }, inventoryItem: { deletedAt: null } },
      select: { inventoryItemId: true, delta: true, createdAt: true, reversedBy: { select: { id: true } },
        compartment: { select: { drawer: { select: { shelf: { select: { area: true } } } } } } },
    }),
  ]);
  return aggregateInventoryDashboard(items, issues, weeks, now, machine);
}

export async function listUnits(db: PrismaClient) {
  return db.inventoryUnit.findMany({ orderBy: [{ createdAt: 'asc' }, { name: 'asc' }] });
}

export async function createUnit(db: PrismaClient, name: string) {
  const clean = normalizeInventoryUnit(name);
  if (!clean) throw new ApiError(400, '単位を入力してください');
  if (clean.length > UNIT_NAME_MAX_LENGTH) throw new ApiError(400, `単位は${UNIT_NAME_MAX_LENGTH}文字以内で入力してください`);
  return db.inventoryUnit.upsert({ where: { name: clean }, create: { name: clean }, update: {} });
}

export async function setItemUnit(db: PrismaClient, itemId: string, unit: string | null) {
  const clean = await resolveUnit(db, unit);
  const item = await db.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item || item.deletedAt) throw new ApiError(404, 'アイテムが見つかりません');
  return db.inventoryItem.update({ where: { id: itemId }, data: { unit: clean } });
}

/** Change one item's name and tool information; fields left out stay as they are. */
export async function updateItemDetails(db: PrismaClient, itemId: string, input: Partial<Record<InventoryOptionField, string>> & { unitPrice?: number | null }) {
  const data: Partial<Record<InventoryOptionField, string | null>> & { unitPrice?: number | null } = {};
  if (input.unitPrice !== undefined) {
    if (input.unitPrice !== null && (!Number.isInteger(input.unitPrice) || input.unitPrice < 0 || input.unitPrice > 10_000_000)) {
      throw new ApiError(400, '単価は0〜10000000円で入力してください');
    }
    data.unitPrice = input.unitPrice;
  }
  for (const field of INVENTORY_OPTION_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    const clean = value.normalize('NFKC').trim();
    if (clean.length > TOOL_FIELD_VALUE_MAX_LENGTH) throw new ApiError(400, `値は${TOOL_FIELD_VALUE_MAX_LENGTH}文字以内で入力してください`);
    if (field === 'name' && !clean) throw new ApiError(400, '名前を入力してください');
    data[field] = clean || null;
  }
  const item = await db.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item || item.deletedAt) throw new ApiError(404, 'アイテムが見つかりません');
  if (Object.keys(data).length === 0) return item;
  return db.inventoryItem.update({ where: { id: itemId }, data: data as never });
}

export async function createShelf(db: PrismaClient, area: string, shelfNumber: number) {
  const trimmedArea = normalizeInventoryArea(area);
  if (!trimmedArea) throw new ApiError(400, 'エリアを指定してください');
  positiveInteger(shelfNumber, '棚番号');
  return db.inventoryShelf.upsert({
    where: { area_shelfNumber: { area: trimmedArea, shelfNumber } },
    create: { area: trimmedArea, shelfNumber },
    update: {},
  });
}

/** Rename an area (every shelf in it). Drawers, compartments, stock and tags stay attached. */
export async function renameArea(db: PrismaClient, from: string, to: string) {
  const source = normalizeInventoryArea(from);
  const target = normalizeInventoryArea(to);
  if (!source || !target) throw new ApiError(400, 'エリアを指定してください');
  if (source === target) return { renamed: 0, area: target };
  return db.$transaction(async (tx) => {
    const shelves = await tx.inventoryShelf.findMany({ where: { area: source }, select: { shelfNumber: true } });
    if (shelves.length === 0) throw new ApiError(404, 'エリアが見つかりません');
    const clash = await tx.inventoryShelf.findFirst({ where: { area: target, shelfNumber: { in: shelves.map((shelf) => shelf.shelfNumber) } } });
    if (clash) throw new InventoryConflictError(`「${target}」には同じ番号の棚があります（棚${clash.shelfNumber}）`);
    const result = await tx.inventoryShelf.updateMany({ where: { area: source }, data: { area: target } });
    return { renamed: result.count, area: target };
  });
}

export async function createDrawer(db: PrismaClient, shelfId: string, drawerNumber: number) {
  positiveInteger(drawerNumber, '引き出し番号');
  const shelf = await db.inventoryShelf.findUnique({ where: { id: shelfId } });
  if (!shelf) throw new ApiError(404, '棚が見つかりません');
  return db.inventoryDrawer.upsert({
    where: { shelfId_drawerNumber: { shelfId, drawerNumber } },
    create: { shelfId, drawerNumber },
    update: {},
  });
}

export async function upsertQuantityTag(db: PrismaClient, uid: string, quantity: number) {
  const cleanUid = uid.trim();
  if (!cleanUid) throw new ApiError(400, 'NFC UIDを指定してください');
  positiveInteger(quantity, '数量');
  return db.$transaction(async (tx) => {
    await assertNfcUidAvailable(cleanUid, tx);
    const existing = await tx.inventoryNfcTag.findUnique({ where: { uid: cleanUid } });
    if (existing?.kind === InventoryNfcTagKind.ITEM || existing?.kind === InventoryNfcTagKind.RESTOCK) {
      throw new ApiError(409, 'このUIDは別の用途で登録されています');
    }
    return tx.inventoryNfcTag.upsert({
      where: { uid: cleanUid },
      create: { uid: cleanUid, kind: InventoryNfcTagKind.QUANTITY, quantity },
      update: { kind: InventoryNfcTagKind.QUANTITY, quantity, compartmentId: null },
    });
  });
}

export async function upsertRestockTag(db: PrismaClient, uid: string) {
  const cleanUid = uid.trim();
  if (!cleanUid) throw new ApiError(400, 'NFC UIDを指定してください');
  return db.$transaction(async (tx) => {
    await assertNfcUidAvailable(cleanUid, tx);
    const existing = await tx.inventoryNfcTag.findUnique({ where: { uid: cleanUid } });
    if (existing?.kind === InventoryNfcTagKind.ITEM) throw new ApiError(409, 'このUIDはアイテムタグとして使用中です');
    return tx.inventoryNfcTag.upsert({
      where: { uid: cleanUid },
      create: { uid: cleanUid, kind: InventoryNfcTagKind.RESTOCK },
      update: { kind: InventoryNfcTagKind.RESTOCK, quantity: null, compartmentId: null },
    });
  });
}
