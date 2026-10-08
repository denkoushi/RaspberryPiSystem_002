import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, InventoryImportPayloadStatus, InventoryNfcTagKind, InventoryRegistrationMode, InventoryTransactionAction } from '@prisma/client';

import { prisma as defaultPrisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { PhotoStorage } from '../../lib/photo-storage.js';

import { normalizeInventoryArea, normalizeInventoryUnit } from './inventory-area.js';

const UNIT_NAME_MAX_LENGTH = 20;

/** Optional tool information shown and chosen on the kiosk registration screen. */
export const INVENTORY_TOOL_FIELDS = ['maker', 'toolName', 'workMaterial', 'toolSize'] as const;
export type InventoryToolField = (typeof INVENTORY_TOOL_FIELDS)[number];
type InventoryToolInput = Partial<Record<InventoryToolField, string>>;
/** Fields that offer a pick list on the kiosk: 名前, the tool fields, 型式 and 用途. */
export const INVENTORY_OPTION_FIELDS = ['name', ...INVENTORY_TOOL_FIELDS, 'model', 'usage'] as const;
export type InventoryOptionField = (typeof INVENTORY_OPTION_FIELDS)[number];
/** The name an item gets when none was typed at registration; it is never offered as a choice. */
const PROVISIONAL_NAME = /^ItemlistRaspi \d+$/;

/** 名前 is a required column, so it has no null rows to leave out. */
function usedValueWhere(field: InventoryOptionField) {
  return field === 'name' ? { deletedAt: null } : { deletedAt: null, [field]: { not: null } };
}

function isOfferedValue(field: InventoryOptionField, value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !(field === 'name' && PROVISIONAL_NAME.test(value));
}
const TOOL_FIELD_VALUE_MAX_LENGTH = 200;

/** Natural order so that φ20 comes before φ100. */
function compareOptionValues(a: string, b: string): number {
  return a.localeCompare(b, 'ja', { numeric: true });
}

function cleanOptionValue(value: string): string {
  const clean = value.normalize('NFKC').trim();
  if (!clean) throw new ApiError(400, '値を入力してください');
  if (clean.length > TOOL_FIELD_VALUE_MAX_LENGTH) throw new ApiError(400, `値は${TOOL_FIELD_VALUE_MAX_LENGTH}文字以内で入力してください`);
  return clean;
}

function toolData(input: InventoryToolInput, keepMissing: boolean): Partial<Record<InventoryToolField, string | null>> {
  const data: Partial<Record<InventoryToolField, string | null>> = {};
  for (const field of INVENTORY_TOOL_FIELDS) {
    const value = input[field];
    if (value === undefined) {
      if (!keepMissing) data[field] = null;
      continue;
    }
    data[field] = value.normalize('NFKC').trim() || null;
  }
  return data;
}

export class InventoryInsufficientStockError extends Error {
  constructor() {
    super('在庫が不足しています');
    this.name = 'InventoryInsufficientStockError';
  }
}

export class InventoryConflictError extends Error {
  constructor(message = '在庫が更新されています。画面を再読み込みしてください') {
    super(message);
    this.name = 'InventoryConflictError';
  }
}

export type InventoryActor = {
  clientId?: string | null;
  performedByUserId?: string | null;
};

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new ApiError(400, `${label}は1以上の整数で指定してください`);
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new ApiError(400, `${label}は0以上の整数で指定してください`);
  return value;
}

function newItemCode(sourceItemId: number): string {
  return `RI-${sourceItemId}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function locationDto(compartment: {
  id: string;
  stockQuantity: number;
  drawer: { drawerNumber: number; shelf: { area: string; shelfNumber: number } };
  itemTag: { uid: string } | null;
  inventoryItem: { id: string; itemCode: string; name: string; model: string | null; usage: string | null; category: string | null; area: string | null; note: string | null; unit?: string | null; maker?: string | null; toolName?: string | null; workMaterial?: string | null; toolSize?: string | null; photos?: Array<{ id: string; photoIndex: number; photoUrl: string; originalFilename: string }> };
}) {
  return {
    id: compartment.id,
    stockQuantity: compartment.stockQuantity,
    area: compartment.drawer.shelf.area,
    shelfNumber: compartment.drawer.shelf.shelfNumber,
    drawerNumber: compartment.drawer.drawerNumber,
    itemTagUid: compartment.itemTag?.uid ?? null,
    item: {
      id: compartment.inventoryItem.id,
      itemCode: compartment.inventoryItem.itemCode,
      name: compartment.inventoryItem.name,
      model: compartment.inventoryItem.model,
      usage: compartment.inventoryItem.usage,
      category: compartment.inventoryItem.category,
      area: compartment.inventoryItem.area,
      note: compartment.inventoryItem.note,
      unit: compartment.inventoryItem.unit ?? null,
      maker: compartment.inventoryItem.maker ?? null,
      toolName: compartment.inventoryItem.toolName ?? null,
      workMaterial: compartment.inventoryItem.workMaterial ?? null,
      toolSize: compartment.inventoryItem.toolSize ?? null,
      photos: compartment.inventoryItem.photos ?? [],
    },
  };
}

export class ItemInventoryService {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  private async assertNfcUidAvailable(uid: string, db: PrismaClient | Prisma.TransactionClient): Promise<void> {
    const [employee, item, measuringInstrumentTag, riggingGearTag] = await Promise.all([
      db.employee.findFirst({ where: { nfcTagUid: uid }, select: { id: true } }),
      db.item.findFirst({ where: { nfcTagUid: uid }, select: { id: true } }),
      db.measuringInstrumentTag.findFirst({ where: { rfidTagUid: uid }, select: { id: true } }),
      db.riggingGearTag.findFirst({ where: { rfidTagUid: uid }, select: { id: true } }),
    ]);
    if (employee || item || measuringInstrumentTag || riggingGearTag) {
      throw new ApiError(409, 'このUIDは既存の社員・工具・計測機器・玉掛け具で使用中です');
    }
  }

  private async serializable<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt === 2) throw error;
      }
    }
    throw new Error('unreachable');
  }

  async resolveTag(uid: string) {
    const tag = await this.db.inventoryNfcTag.findUnique({
      where: { uid: uid.trim() },
      include: {
        compartment: {
          include: {
            drawer: { include: { shelf: true } },
            inventoryItem: { include: { photos: { orderBy: [{ photoIndex: 'asc' }, { createdAt: 'asc' }] } } },
            itemTag: true,
          },
        },
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

  async listTags() {
    const tags = await this.db.inventoryNfcTag.findMany({
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

  async listLocations() {
    const shelves = await this.db.inventoryShelf.findMany({
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

  async listItems() {
    const items = await this.db.inventoryItem.findMany({
      where: { deletedAt: null },
      orderBy: [{ name: 'asc' }, { itemCode: 'asc' }],
      include: {
        photos: {
          orderBy: [{ photoIndex: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, inventoryItemId: true, photoUrl: true, originalFilename: true, photoIndex: true, createdAt: true },
        },
        compartments: {
          include: { drawer: { include: { shelf: true } }, itemTag: true },
          orderBy: { createdAt: 'asc' },
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

  async deleteItem(itemId: string) {
    return this.db.$transaction(async (tx) => {
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

  async deleteDrawer(id: string) {
    return this.serializable(async (tx) => {
      // Parent row locks also block concurrent child creation through the FK.
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "InventoryDrawer" WHERE "id" = ${id} FOR UPDATE`);
      const drawer = await tx.inventoryDrawer.findUnique({ where: { id }, include: { _count: { select: { compartments: true } } } });
      if (!drawer) throw new ApiError(404, '引き出しが見つかりません');
      if (drawer._count.compartments > 0) throw new InventoryConflictError('品物が入っている引き出しは削除できません');
      await tx.inventoryDrawer.delete({ where: { id } });
      return { id };
    });
  }

  async deleteShelf(id: string) {
    return this.serializable(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "InventoryShelf" WHERE "id" = ${id} FOR UPDATE`);
      const shelf = await tx.inventoryShelf.findUnique({ where: { id }, include: { _count: { select: { drawers: true } } } });
      if (!shelf) throw new ApiError(404, '棚が見つかりません');
      if (shelf._count.drawers > 0) throw new InventoryConflictError('引き出しがある棚は削除できません');
      await tx.inventoryShelf.delete({ where: { id } });
      return { id };
    });
  }

  async deleteTag(id: string) {
    return this.serializable(async (tx) => {
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

  async dismissImport(id: string) {
    return this.changeImportStatus(id, InventoryImportPayloadStatus.PENDING, InventoryImportPayloadStatus.DISMISSED);
  }

  async restoreImport(id: string) {
    return this.changeImportStatus(id, InventoryImportPayloadStatus.DISMISSED, InventoryImportPayloadStatus.PENDING);
  }

  private async changeImportStatus(id: string, expectedStatus: InventoryImportPayloadStatus, status: InventoryImportPayloadStatus) {
    return this.serializable(async (tx) => {
      const payload = await tx.inventoryImportPayload.findUnique({ where: { id }, select: { id: true } });
      if (!payload) throw new ApiError(404, 'インポート候補が見つかりません');
      const updated = await tx.inventoryImportPayload.updateMany({ where: { id, status: expectedStatus }, data: { status } });
      if (updated.count !== 1) throw new InventoryConflictError('この候補の状態が変わっています');
      return { id, status };
    });
  }

  async listPendingImports() {
    return this.db.inventoryImportPayload.findMany({
      where: { status: InventoryImportPayloadStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      include: { photos: { orderBy: { photoIndex: 'asc' } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
  }

  /** Pending candidates for the kiosk item list: newest first, one thumbnail each, no manifest or mail details. */
  async listPendingImportSummaries() {
    const payloads = await this.db.inventoryImportPayload.findMany({
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

  async deleteImportPhoto(payloadId: string, photoId: string) {
    const result = await this.serializable(async (tx) => {
      const payload = await tx.inventoryImportPayload.findUnique({ where: { id: payloadId }, select: { status: true } });
      if (!payload) throw new ApiError(404, 'インポート候補が見つかりません');
      if (payload.status !== InventoryImportPayloadStatus.PENDING) throw new ApiError(409, '登録済みの候補は編集できません');

      const photo = await tx.inventoryImportPhoto.findFirst({ where: { id: photoId, payloadId } });
      if (!photo) throw new ApiError(404, '写真が見つかりません');
      const remaining = await tx.inventoryImportPhoto.findMany({
        where: { payloadId, id: { not: photoId } },
        orderBy: [{ photoIndex: 'asc' }, { createdAt: 'asc' }],
      });

      await tx.inventoryImportPhoto.delete({ where: { id: photoId } });
      for (const [index, remainingPhoto] of remaining.entries()) {
        await tx.inventoryImportPhoto.update({ where: { id: remainingPhoto.id }, data: { photoIndex: -(index + 1) } });
      }
      for (const [index, remainingPhoto] of remaining.entries()) {
        await tx.inventoryImportPhoto.update({ where: { id: remainingPhoto.id }, data: { photoIndex: index + 1 } });
      }

      const [registeredReferences, pendingReferences] = await Promise.all([
        tx.inventoryItemPhoto.count({ where: { photoUrl: photo.photoUrl } }),
        tx.inventoryImportPhoto.count({ where: { photoUrl: photo.photoUrl } }),
      ]);
      return {
        photoId,
        photoUrlToDelete: registeredReferences === 0 && pendingReferences === 0 ? photo.photoUrl : null,
      };
    });

    if (result.photoUrlToDelete) {
      try {
        await PhotoStorage.deletePhoto(result.photoUrlToDelete);
      } catch (error) {
        logger.warn({ err: error, payloadId, photoId, photoUrl: result.photoUrlToDelete }, 'Inventory import photo file deletion failed');
      }
    }
    return { photoId: result.photoId };
  }

  async reorderImportPhotos(payloadId: string, photoIds: string[]) {
    await this.serializable(async (tx) => {
      const payload = await tx.inventoryImportPayload.findUnique({ where: { id: payloadId }, select: { status: true } });
      if (!payload) throw new ApiError(404, 'インポート候補が見つかりません');
      if (payload.status !== InventoryImportPayloadStatus.PENDING) throw new ApiError(409, '登録済みの候補は編集できません');

      const photos = await tx.inventoryImportPhoto.findMany({
        where: { payloadId },
        orderBy: [{ photoIndex: 'asc' }, { createdAt: 'asc' }],
      });
      const photoIdsSet = new Set(photoIds);
      const knownPhotoIds = new Set(photos.map((photo) => photo.id));
      if (photoIds.length !== photos.length || photoIdsSet.size !== photos.length || photoIds.some((id) => !knownPhotoIds.has(id))) {
        throw new ApiError(400, '写真の並び順が不正です');
      }

      for (const [index, photo] of photos.entries()) {
        await tx.inventoryImportPhoto.update({ where: { id: photo.id }, data: { photoIndex: -(index + 1) } });
      }
      for (const [index, id] of photoIds.entries()) {
        await tx.inventoryImportPhoto.update({ where: { id }, data: { photoIndex: index + 1 } });
      }
    });
    return { payloadId, photoIds };
  }

  async deleteInventoryItemPhoto(itemId: string, photoId: string) {
    const result = await this.serializable(async (tx) => {
      const photo = await tx.inventoryItemPhoto.findFirst({ where: { id: photoId, inventoryItemId: itemId } });
      if (!photo) throw new ApiError(404, '登録済み写真が見つかりません');

      await tx.inventoryItemPhoto.delete({ where: { id: photoId } });
      const remaining = await tx.inventoryItemPhoto.findMany({
        where: { inventoryItemId: itemId },
        orderBy: [{ photoIndex: 'asc' }, { createdAt: 'asc' }],
      });
      for (const [index, remainingPhoto] of remaining.entries()) {
        await tx.inventoryItemPhoto.update({ where: { id: remainingPhoto.id }, data: { photoIndex: -(index + 1) } });
      }
      for (const [index, remainingPhoto] of remaining.entries()) {
        await tx.inventoryItemPhoto.update({ where: { id: remainingPhoto.id }, data: { photoIndex: index + 1 } });
      }

      const [registeredReferences, pendingReferences] = await Promise.all([
        tx.inventoryItemPhoto.count({ where: { photoUrl: photo.photoUrl } }),
        tx.inventoryImportPhoto.count({ where: { photoUrl: photo.photoUrl } }),
      ]);
      return {
        photoId,
        photoUrlToDelete: registeredReferences === 0 && pendingReferences === 0 ? photo.photoUrl : null,
      };
    });

    if (result.photoUrlToDelete) {
      try {
        await PhotoStorage.deletePhoto(result.photoUrlToDelete);
      } catch (error) {
        logger.warn({ err: error, itemId, photoId, photoUrl: result.photoUrlToDelete }, 'Registered inventory photo file deletion failed');
      }
    }
    return { photoId: result.photoId };
  }

  async reorderInventoryItemPhotos(itemId: string, photoIds: string[]) {
    await this.serializable(async (tx) => {
      const photos = await tx.inventoryItemPhoto.findMany({
        where: { inventoryItemId: itemId },
        orderBy: [{ photoIndex: 'asc' }, { createdAt: 'asc' }],
      });
      const photoIdsSet = new Set(photoIds);
      const knownPhotoIds = new Set(photos.map((photo) => photo.id));
      if (photoIds.length !== photos.length || photoIdsSet.size !== photos.length || photoIds.some((id) => !knownPhotoIds.has(id))) {
        throw new ApiError(400, '登録済み写真の並び順が不正です');
      }
      for (const [index, photo] of photos.entries()) {
        await tx.inventoryItemPhoto.update({ where: { id: photo.id }, data: { photoIndex: -(index + 1) } });
      }
      for (const [index, id] of photoIds.entries()) {
        await tx.inventoryItemPhoto.update({ where: { id }, data: { photoIndex: index + 1 } });
      }
    });
    return { itemId, photoIds };
  }

  async listImportMessages() {
    return this.db.inventoryImportMessage.findMany({ orderBy: { updatedAt: 'desc' }, take: 100 });
  }

  async listHistory(limit = 100, filter: { compartmentId?: string } = {}) {
    return this.db.inventoryTransaction.findMany({
      where: filter.compartmentId ? { compartmentId: filter.compartmentId } : undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(limit, 1), 500),
      include: { inventoryItem: true, compartment: { include: { drawer: { include: { shelf: true } } } } },
    });
  }

  /** Pre-registered choices plus values already used, for each field offered in the kiosk pop-up. */
  async listToolFieldOptions(): Promise<Record<InventoryOptionField, string[]>> {
    const presets = await this.db.inventoryToolFieldPreset.findMany({ select: { field: true, value: true } });
    const entries = await Promise.all(INVENTORY_OPTION_FIELDS.map(async (field) => {
      const rows = await this.db.inventoryItem.findMany({
        where: usedValueWhere(field),
        select: { [field]: true },
        distinct: [field],
        orderBy: { [field]: 'asc' },
      }) as unknown as Array<Record<string, string | null>>;
      const used = rows.map((row) => row[field]).filter((value): value is string => isOfferedValue(field, value));
      const preset = presets.filter((entry) => entry.field === field).map((entry) => entry.value);
      return [field, [...new Set([...used, ...preset])].sort(compareOptionValues)] as const;
    }));
    return Object.fromEntries(entries) as Record<InventoryOptionField, string[]>;
  }

  /** Each field's choices with how many items use them, for the kiosk edit mode. */
  async listToolFieldValues(): Promise<Record<InventoryOptionField, Array<{ value: string; count: number }>>> {
    const presets = await this.db.inventoryToolFieldPreset.findMany({ select: { field: true, value: true } });
    const entries = await Promise.all(INVENTORY_OPTION_FIELDS.map(async (field) => {
      const groups = await this.db.inventoryItem.groupBy({
        by: [field],
        where: usedValueWhere(field),
        _count: { _all: true },
      } as never) as unknown as Array<Record<string, unknown> & { _count: { _all: number } }>;
      const counts = new Map<string, number>();
      for (const group of groups) {
        const value = group[field];
        if (isOfferedValue(field, value)) counts.set(value, group._count._all);
      }
      for (const preset of presets) {
        if (preset.field === field && !counts.has(preset.value)) counts.set(preset.value, 0);
      }
      const values = [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => compareOptionValues(a.value, b.value));
      return [field, values] as const;
    }));
    return Object.fromEntries(entries) as Record<InventoryOptionField, Array<{ value: string; count: number }>>;
  }

  async addToolFieldValue(field: InventoryOptionField, value: string) {
    const clean = cleanOptionValue(value);
    await this.db.inventoryToolFieldPreset.upsert({ where: { field_value: { field, value: clean } }, create: { field, value: clean }, update: {} });
    return { field, value: clean };
  }

  /** Rename a choice and every item that uses it, in one transaction. */
  async renameToolFieldValue(field: InventoryOptionField, from: string, to: string) {
    const source = cleanOptionValue(from);
    const target = cleanOptionValue(to);
    if (source === target) return { field, value: target, updatedItems: 0 };
    return this.db.$transaction(async (tx) => {
      const result = await tx.inventoryItem.updateMany({ where: { deletedAt: null, [field]: source }, data: { [field]: target } });
      const removed = await tx.inventoryToolFieldPreset.deleteMany({ where: { field, value: source } });
      if (removed.count > 0) {
        await tx.inventoryToolFieldPreset.upsert({ where: { field_value: { field, value: target } }, create: { field, value: target }, update: {} });
      }
      return { field, value: target, updatedItems: result.count };
    });
  }

  /** Only a choice no item uses can be removed; otherwise it would come back from the items. */
  async deleteToolFieldValue(field: InventoryOptionField, value: string) {
    const clean = cleanOptionValue(value);
    const used = await this.db.inventoryItem.count({ where: { deletedAt: null, [field]: clean } });
    if (used > 0) throw new InventoryConflictError(`「${clean}」は${used}件のアイテムで使っています`);
    await this.db.inventoryToolFieldPreset.deleteMany({ where: { field, value: clean } });
    return { field, value: clean };
  }

  async listUnits() {
    return this.db.inventoryUnit.findMany({ orderBy: [{ createdAt: 'asc' }, { name: 'asc' }] });
  }

  async createUnit(name: string) {
    const clean = normalizeInventoryUnit(name);
    if (!clean) throw new ApiError(400, '単位を入力してください');
    if (clean.length > UNIT_NAME_MAX_LENGTH) throw new ApiError(400, `単位は${UNIT_NAME_MAX_LENGTH}文字以内で入力してください`);
    return this.db.inventoryUnit.upsert({ where: { name: clean }, create: { name: clean }, update: {} });
  }

  /** A unit must be one of the offered units; null returns the item to 個. */
  private async resolveUnit(unit: string | null): Promise<string | null> {
    if (unit === null) return null;
    const clean = normalizeInventoryUnit(unit);
    if (!clean) return null;
    const known = await this.db.inventoryUnit.findUnique({ where: { name: clean } });
    if (!known) throw new ApiError(400, `単位「${clean}」は登録されていません`);
    return clean;
  }

  async setItemUnit(itemId: string, unit: string | null) {
    const clean = await this.resolveUnit(unit);
    const item = await this.db.inventoryItem.findUnique({ where: { id: itemId } });
    if (!item || item.deletedAt) throw new ApiError(404, 'アイテムが見つかりません');
    return this.db.inventoryItem.update({ where: { id: itemId }, data: { unit: clean } });
  }

  /** Change one item's name and tool information; fields left out stay as they are. */
  async updateItemDetails(itemId: string, input: Partial<Record<InventoryOptionField, string>>) {
    const data: Partial<Record<InventoryOptionField, string | null>> = {};
    for (const field of INVENTORY_OPTION_FIELDS) {
      const value = input[field];
      if (value === undefined) continue;
      const clean = value.normalize('NFKC').trim();
      if (clean.length > TOOL_FIELD_VALUE_MAX_LENGTH) throw new ApiError(400, `値は${TOOL_FIELD_VALUE_MAX_LENGTH}文字以内で入力してください`);
      if (field === 'name' && !clean) throw new ApiError(400, '名前を入力してください');
      data[field] = clean || null;
    }
    const item = await this.db.inventoryItem.findUnique({ where: { id: itemId } });
    if (!item || item.deletedAt) throw new ApiError(404, 'アイテムが見つかりません');
    if (Object.keys(data).length === 0) return item;
    return this.db.inventoryItem.update({ where: { id: itemId }, data: data as never });
  }

  async createShelf(area: string, shelfNumber: number) {
    const trimmedArea = normalizeInventoryArea(area);
    if (!trimmedArea) throw new ApiError(400, 'エリアを指定してください');
    positiveInteger(shelfNumber, '棚番号');
    return this.db.inventoryShelf.upsert({
      where: { area_shelfNumber: { area: trimmedArea, shelfNumber } },
      create: { area: trimmedArea, shelfNumber },
      update: {},
    });
  }

  /** Rename an area (every shelf in it). Drawers, compartments, stock and tags stay attached. */
  async renameArea(from: string, to: string) {
    const source = normalizeInventoryArea(from);
    const target = normalizeInventoryArea(to);
    if (!source || !target) throw new ApiError(400, 'エリアを指定してください');
    if (source === target) return { renamed: 0, area: target };
    return this.db.$transaction(async (tx) => {
      const shelves = await tx.inventoryShelf.findMany({ where: { area: source }, select: { shelfNumber: true } });
      if (shelves.length === 0) throw new ApiError(404, 'エリアが見つかりません');
      const clash = await tx.inventoryShelf.findFirst({ where: { area: target, shelfNumber: { in: shelves.map((shelf) => shelf.shelfNumber) } } });
      if (clash) throw new InventoryConflictError(`「${target}」には同じ番号の棚があります（棚${clash.shelfNumber}）`);
      const result = await tx.inventoryShelf.updateMany({ where: { area: source }, data: { area: target } });
      return { renamed: result.count, area: target };
    });
  }

  async createDrawer(shelfId: string, drawerNumber: number) {
    positiveInteger(drawerNumber, '引き出し番号');
    const shelf = await this.db.inventoryShelf.findUnique({ where: { id: shelfId } });
    if (!shelf) throw new ApiError(404, '棚が見つかりません');
    return this.db.inventoryDrawer.upsert({
      where: { shelfId_drawerNumber: { shelfId, drawerNumber } },
      create: { shelfId, drawerNumber },
      update: {},
    });
  }

  async upsertQuantityTag(uid: string, quantity: number) {
    const cleanUid = uid.trim();
    if (!cleanUid) throw new ApiError(400, 'NFC UIDを指定してください');
    positiveInteger(quantity, '数量');
    return this.db.$transaction(async (tx) => {
      await this.assertNfcUidAvailable(cleanUid, tx);
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

  async upsertRestockTag(uid: string) {
    const cleanUid = uid.trim();
    if (!cleanUid) throw new ApiError(400, 'NFC UIDを指定してください');
    return this.db.$transaction(async (tx) => {
      await this.assertNfcUidAvailable(cleanUid, tx);
      const existing = await tx.inventoryNfcTag.findUnique({ where: { uid: cleanUid } });
      if (existing?.kind === InventoryNfcTagKind.ITEM) throw new ApiError(409, 'このUIDはアイテムタグとして使用中です');
      return tx.inventoryNfcTag.upsert({
        where: { uid: cleanUid },
        create: { uid: cleanUid, kind: InventoryNfcTagKind.RESTOCK },
        update: { kind: InventoryNfcTagKind.RESTOCK, quantity: null, compartmentId: null },
      });
    });
  }

  async registerImport(input: {
    payloadId: string;
    mode: 'NEW_ITEM' | 'EXISTING_ITEM';
    itemId?: string;
    name?: string;
    model?: string;
    usage?: string;
    shelfId?: string;
    drawerId?: string;
    itemTagUid?: string;
    initialQuantity?: number;
    reviewNote?: string;
    unit?: string | null;
    maker?: string;
    toolName?: string;
    workMaterial?: string;
    toolSize?: string;
    actor?: InventoryActor;
  }) {
    if (!input.shelfId || !input.drawerId || !input.itemTagUid) {
      if (input.mode === 'NEW_ITEM') throw new ApiError(400, 'エリア、棚、引き出し、アイテムNFCタグを指定してください');
    }
    if (input.mode === 'EXISTING_ITEM' && !input.itemId) {
      throw new ApiError(400, '既存アイテムを選択してください');
    }
    const initialQuantity = input.mode === 'NEW_ITEM' ? nonNegativeInteger(input.initialQuantity ?? 0, '初期数量') : 0;
    const cleanUid = input.mode === 'NEW_ITEM' ? input.itemTagUid!.trim() : '';
    const unit = input.unit === undefined ? undefined : await this.resolveUnit(input.unit);
    if (input.mode === 'NEW_ITEM' && !cleanUid) throw new ApiError(400, 'アイテムNFC UIDを指定してください');

    return this.serializable(async (tx) => {
      const currentPayload = await tx.inventoryImportPayload.findUnique({
        where: { id: input.payloadId },
        include: { photos: { orderBy: { photoIndex: 'asc' } } },
      });
      if (!currentPayload) throw new ApiError(404, 'インポート候補が見つかりません');
      if (currentPayload.status !== InventoryImportPayloadStatus.PENDING) throw new ApiError(409, 'この候補は処理済みです');
      const claim = await tx.inventoryImportPayload.updateMany({
        where: { id: input.payloadId, status: InventoryImportPayloadStatus.PENDING },
        // Transition inside the transaction so a concurrent registrar cannot
        // match the same PENDING row after the first transaction commits.
        // Any later failure rolls this claim back with the rest of the work.
        data: { status: InventoryImportPayloadStatus.REGISTERED },
      });
      if (claim.count !== 1) throw new ApiError(409, 'この候補は処理済みです');

      if (input.mode === 'EXISTING_ITEM') {
        const existing = await tx.inventoryItem.findUnique({ where: { id: input.itemId! } });
        if (!existing) throw new ApiError(404, '既存アイテムが見つかりません');
        if (existing.deletedAt) throw new ApiError(404, '既存アイテムが見つかりません');
        const lastPhoto = await tx.inventoryItemPhoto.findFirst({
          where: { inventoryItemId: existing.id },
          orderBy: [{ photoIndex: 'desc' }, { createdAt: 'desc' }],
          select: { photoIndex: true },
        });
        let nextPhotoIndex = (lastPhoto?.photoIndex ?? 0) + 1;
        const updated = await tx.inventoryItem.update({
          where: { id: existing.id },
          data: {
            ...(input.name?.trim() ? { name: input.name.trim() } : {}),
            ...(input.model !== undefined ? { model: input.model.trim() || null } : {}),
            ...(input.usage !== undefined ? { usage: input.usage.trim() || null } : {}),
            ...(currentPayload.category !== null ? { category: currentPayload.category } : {}),
            ...(currentPayload.note !== null ? { note: currentPayload.note } : {}),
            ...(unit !== undefined ? { unit } : {}),
            ...toolData(input, true),
          },
        });
        for (const photo of currentPayload.photos) {
          const already = await tx.inventoryItemPhoto.findFirst({ where: { inventoryItemId: existing.id, sha256: photo.sha256 } });
          if (!already) {
            await tx.inventoryItemPhoto.create({
              data: {
                inventoryItemId: existing.id,
                photoUrl: photo.photoUrl,
                originalFilename: photo.filename,
                sha256: photo.sha256,
                sourcePayloadId: currentPayload.id,
                photoIndex: nextPhotoIndex++,
              },
            });
          }
        }
        await tx.inventoryImportPayload.update({
          where: { id: currentPayload.id },
          data: {
            status: InventoryImportPayloadStatus.REGISTERED,
            registrationMode: InventoryRegistrationMode.EXISTING_ITEM,
            registeredItemId: existing.id,
            reviewedAt: new Date(),
            reviewNote: input.reviewNote?.trim() || null,
          },
        });
        return { mode: input.mode, item: updated };
      }

      const cleanName = input.name?.trim() || `ItemlistRaspi ${currentPayload.sourceItemId}`;
      const drawer = await tx.inventoryDrawer.findUnique({ where: { id: input.drawerId }, include: { shelf: true } });
      if (!drawer || drawer.shelfId !== input.shelfId) throw new ApiError(400, '棚と引き出しの組み合わせが不正です');
      // The mail location names the machine; shelves are named by machine + direction and may
      // serve other machines too, so any shelf may be chosen. The item keeps the machine in `area`.
      await this.assertNfcUidAvailable(cleanUid, tx);
      const existingTag = await tx.inventoryNfcTag.findUnique({ where: { uid: cleanUid } });
      if (existingTag && (existingTag.kind !== InventoryNfcTagKind.ITEM || existingTag.compartmentId)) {
        throw new ApiError(409, 'このUIDは既に使用されています');
      }
      const item = await tx.inventoryItem.create({
        data: {
          itemCode: newItemCode(currentPayload.sourceItemId),
          name: cleanName,
          model: input.model?.trim() || null,
          usage: input.usage?.trim() || null,
          category: currentPayload.category,
          area: currentPayload.area,
          note: currentPayload.note,
          unit: unit ?? null,
          ...toolData(input, false),
          photos: {
            create: currentPayload.photos.map((photo, index) => ({
              photoUrl: photo.photoUrl,
              originalFilename: photo.filename,
              sha256: photo.sha256,
              sourcePayloadId: currentPayload.id,
              photoIndex: index + 1,
            })),
          },
        },
      });
      const compartment = await tx.inventoryCompartment.create({
        data: { drawerId: drawer.id, inventoryItemId: item.id, stockQuantity: initialQuantity },
      });
      if (existingTag) {
        await tx.inventoryNfcTag.update({ where: { id: existingTag.id }, data: { compartmentId: compartment.id } });
      } else {
        await tx.inventoryNfcTag.create({ data: { uid: cleanUid, kind: InventoryNfcTagKind.ITEM, compartmentId: compartment.id } });
      }
      await tx.inventoryTransaction.create({
        data: {
          action: InventoryTransactionAction.REGISTER,
          inventoryItemId: item.id,
          compartmentId: compartment.id,
          clientId: input.actor?.clientId ?? null,
          performedByUserId: input.actor?.performedByUserId ?? null,
          delta: initialQuantity,
          beforeQuantity: 0,
          afterQuantity: initialQuantity,
          details: { sourcePayloadId: currentPayload.id, itemTagUid: cleanUid },
        },
      });
      await tx.inventoryImportPayload.update({
        where: { id: currentPayload.id },
        data: {
          status: InventoryImportPayloadStatus.REGISTERED,
          registrationMode: InventoryRegistrationMode.NEW_ITEM,
          registeredItemId: item.id,
          reviewedAt: new Date(),
          reviewNote: input.reviewNote?.trim() || null,
        },
      });
      return { mode: input.mode, item, compartment };
    });
  }

  async bindCompartment(input: {
    itemId: string;
    shelfId: string;
    drawerId: string;
    itemTagUid: string;
    initialQuantity: number;
    actor?: InventoryActor;
  }) {
    const cleanUid = input.itemTagUid.trim();
    if (!cleanUid) throw new ApiError(400, 'アイテムNFC UIDを指定してください');
    const initialQuantity = nonNegativeInteger(input.initialQuantity, '初期数量');
    return this.db.$transaction(async (tx) => {
      const [item, drawer] = await Promise.all([
        tx.inventoryItem.findUnique({ where: { id: input.itemId } }),
        tx.inventoryDrawer.findUnique({ where: { id: input.drawerId }, include: { shelf: true } }),
      ]);
      if (!item) throw new ApiError(404, '既存アイテムが見つかりません');
      if (item.deletedAt) throw new ApiError(404, '既存アイテムが見つかりません');
      if (!drawer || drawer.shelfId !== input.shelfId) throw new ApiError(400, '棚と引き出しの組み合わせが不正です');
      await this.assertNfcUidAvailable(cleanUid, tx);
      const existingTag = await tx.inventoryNfcTag.findUnique({ where: { uid: cleanUid } });
      if (existingTag && (existingTag.kind !== InventoryNfcTagKind.ITEM || existingTag.compartmentId)) {
        throw new ApiError(409, 'このUIDは既に使用されています');
      }
      const compartment = await tx.inventoryCompartment.create({
        data: { drawerId: drawer.id, inventoryItemId: item.id, stockQuantity: initialQuantity },
      });
      const tag = existingTag
        ? await tx.inventoryNfcTag.update({ where: { id: existingTag.id }, data: { compartmentId: compartment.id } })
        : await tx.inventoryNfcTag.create({ data: { uid: cleanUid, kind: InventoryNfcTagKind.ITEM, compartmentId: compartment.id } });
      await tx.inventoryTransaction.create({
        data: {
          action: InventoryTransactionAction.REGISTER,
          inventoryItemId: item.id,
          compartmentId: compartment.id,
          clientId: input.actor?.clientId ?? null,
          performedByUserId: input.actor?.performedByUserId ?? null,
          delta: initialQuantity,
          beforeQuantity: 0,
          afterQuantity: initialQuantity,
          details: { binding: 'EXISTING_ITEM', itemTagUid: cleanUid },
        },
      });
      return { item, compartment, tag };
    });
  }

  async processTransaction(input: {
    itemTagUid: string;
    expectedCompartmentId?: string;
    quantityTagUid: string;
    restockTagUid?: string;
    restock: boolean;
    idempotencyKey?: string;
    actor?: InventoryActor;
  }) {
    const itemUid = input.itemTagUid.trim();
    const quantityUid = input.quantityTagUid.trim();
    const commandUid = input.restockTagUid?.trim();
    if (input.restock && !commandUid) throw new ApiError(400, '補充タグを先に読み取ってください');
    return this.processStockTransaction(input, async (tx) => {
      const itemTag = await tx.inventoryNfcTag.findUnique({ where: { uid: itemUid }, include: { compartment: true } });
      if (!itemTag || itemTag.kind !== InventoryNfcTagKind.ITEM || !itemTag.compartmentId) throw new ApiError(400, 'アイテムNFCタグを読み取ってください');
      if (input.restock) {
        const commandTag = await tx.inventoryNfcTag.findUnique({ where: { uid: commandUid! } });
        if (!commandTag || commandTag.kind !== InventoryNfcTagKind.RESTOCK) throw new ApiError(400, '補充NFCタグが不正です');
      }
      const quantityTag = await tx.inventoryNfcTag.findUnique({ where: { uid: quantityUid } });
      if (!quantityTag || quantityTag.kind !== InventoryNfcTagKind.QUANTITY || !quantityTag.quantity) throw new ApiError(400, '数量NFCタグを読み取ってください');
      return {
        compartmentId: itemTag.compartmentId,
        quantity: quantityTag.quantity,
        quantityTagId: quantityTag.id,
        details: { itemTagUid: itemUid, quantityTagUid: quantityUid, restockTagUid: commandUid ?? null },
      };
    });
  }

  async processTouchTransaction(input: {
    compartmentId: string;
    quantity: number;
    restock?: boolean;
    expectedBeforeQuantity?: number;
    idempotencyKey?: string;
    actor?: InventoryActor;
  }) {
    positiveInteger(input.quantity, '数量');
    if (input.quantity > 999999) throw new ApiError(400, '数量は999999以下で指定してください');
    if (input.expectedBeforeQuantity !== undefined) nonNegativeInteger(input.expectedBeforeQuantity, '現在庫');
    return this.processStockTransaction(input, async () => ({
      compartmentId: input.compartmentId,
      quantity: input.quantity,
      details: { source: 'touch' },
    }));
  }

  private async processStockTransaction(
    input: { restock?: boolean; expectedCompartmentId?: string; expectedBeforeQuantity?: number; idempotencyKey?: string; actor?: InventoryActor },
    resolveMovement: (tx: Prisma.TransactionClient) => Promise<{
      compartmentId: string;
      quantity: number;
      quantityTagId?: string;
      details: Prisma.InputJsonValue;
    }>,
  ) {
    let result;
    try {
      result = await this.serializable(async (tx) => {
        if (input.idempotencyKey && input.actor?.clientId) {
          const prior = await tx.inventoryTransaction.findFirst({ where: { clientId: input.actor.clientId, idempotencyKey: input.idempotencyKey } });
          if (prior) return { transaction: prior, replayed: true };
        }
        const movement = await resolveMovement(tx);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "InventoryCompartment" WHERE "id" = ${movement.compartmentId} FOR UPDATE`);
        if (input.expectedCompartmentId !== undefined && input.expectedCompartmentId !== movement.compartmentId) {
          throw new InventoryConflictError('タグの登録が変わりました');
        }
        const compartment = await tx.inventoryCompartment.findUnique({ where: { id: movement.compartmentId } });
        if (!compartment) throw new ApiError(404, '在庫区画が見つかりません');
        if (input.expectedBeforeQuantity !== undefined && input.expectedBeforeQuantity !== compartment.stockQuantity) {
          throw new InventoryConflictError('在庫が変わりました。もう一度数えてください');
        }
        const delta = input.restock ? movement.quantity : -movement.quantity;
        const afterQuantity = compartment.stockQuantity + delta;
        if (afterQuantity < 0) throw new InventoryInsufficientStockError();
        const action = input.restock ? InventoryTransactionAction.RESTOCK : InventoryTransactionAction.ISSUE;
        const createdAt = new Date();
        const updated = await tx.inventoryCompartment.update({
          where: { id: compartment.id },
          data: { stockQuantity: afterQuantity, ...(input.restock ? {} : { lastIssuedAt: createdAt }) },
        });
        const transaction = await tx.inventoryTransaction.create({
          data: {
            action,
            inventoryItemId: compartment.inventoryItemId,
            compartmentId: compartment.id,
            clientId: input.actor?.clientId ?? null,
            performedByUserId: input.actor?.performedByUserId ?? null,
            quantityTagId: movement.quantityTagId ?? null,
            idempotencyKey: input.idempotencyKey ?? null,
            delta,
            beforeQuantity: compartment.stockQuantity,
            afterQuantity: updated.stockQuantity,
            details: movement.details,
            createdAt,
          },
        });
        return { transaction, replayed: false };
      });
    } catch (error) {
      if (input.idempotencyKey && input.actor?.clientId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const prior = await this.db.inventoryTransaction.findFirst({ where: { clientId: input.actor.clientId, idempotencyKey: input.idempotencyKey } });
        if (prior) return { transaction: prior, replayed: true };
      }
      throw error;
    }
    return result;
  }

  async cancelTransaction(id: string, actor: InventoryActor, options: { allowAnyClient?: boolean } = {}) {
    return this.serializable(async (tx) => {
      const original = await tx.inventoryTransaction.findUnique({ where: { id }, include: { reversedBy: true } });
      if (!original || !original.compartmentId) throw new ApiError(404, '取引履歴が見つかりません');
      if (!options.allowAnyClient && original.clientId !== actor.clientId) {
        throw new InventoryConflictError('この端末の直前の取引だけ取消できます');
      }
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "InventoryCompartment" WHERE "id" = ${original.compartmentId} FOR UPDATE`);
      const compartment = await tx.inventoryCompartment.findUnique({ where: { id: original.compartmentId } });
      if (!compartment || compartment.stockQuantity !== original.afterQuantity) throw new InventoryConflictError();
      const latest = await tx.inventoryTransaction.findFirst({ where: { compartmentId: original.compartmentId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      if (!latest || latest.id !== original.id || original.reversedBy) throw new InventoryConflictError('直前の取引だけ取消できます');
      const afterQuantity = compartment.stockQuantity - original.delta;
      if (afterQuantity < 0) throw new InventoryConflictError('取消後の在庫が不正になります');
      const lastIssue = original.action === InventoryTransactionAction.ISSUE
        ? await tx.inventoryTransaction.findFirst({
          where: { compartmentId: compartment.id, action: InventoryTransactionAction.ISSUE, id: { not: original.id }, reversedBy: { is: null } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { createdAt: true },
        })
        : undefined;
      await tx.inventoryCompartment.update({
        where: { id: compartment.id },
        data: { stockQuantity: afterQuantity, ...(lastIssue === undefined ? {} : { lastIssuedAt: lastIssue?.createdAt ?? null }) },
      });
      return tx.inventoryTransaction.create({
        data: {
          action: InventoryTransactionAction.CANCEL,
          inventoryItemId: original.inventoryItemId,
          compartmentId: original.compartmentId,
          clientId: actor.clientId ?? null,
          performedByUserId: actor.performedByUserId ?? null,
          reversalOfId: original.id,
          delta: -original.delta,
          beforeQuantity: compartment.stockQuantity,
          afterQuantity,
          details: { cancelledTransactionId: original.id },
        },
      });
    });
  }

  async correctStock(
    compartmentId: string,
    desiredQuantity: number,
    actor: InventoryActor,
    note?: string,
    options: { expectedBeforeQuantity?: number } = {},
  ) {
    nonNegativeInteger(desiredQuantity, '在庫数');
    return this.serializable(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "InventoryCompartment" WHERE "id" = ${compartmentId} FOR UPDATE`);
      const compartment = await tx.inventoryCompartment.findUnique({ where: { id: compartmentId } });
      if (!compartment) throw new ApiError(404, '在庫区画が見つかりません');
      // The kiosk shows "before -> counted"; refuse if another terminal moved stock in between.
      if (options.expectedBeforeQuantity !== undefined && options.expectedBeforeQuantity !== compartment.stockQuantity) {
        throw new InventoryConflictError('在庫が変わりました。もう一度数えてください');
      }
      const delta = desiredQuantity - compartment.stockQuantity;
      await tx.inventoryCompartment.update({ where: { id: compartmentId }, data: { stockQuantity: desiredQuantity } });
      return tx.inventoryTransaction.create({
        data: {
          action: InventoryTransactionAction.CORRECTION,
          inventoryItemId: compartment.inventoryItemId,
          compartmentId,
          clientId: actor.clientId ?? null,
          performedByUserId: actor.performedByUserId ?? null,
          delta,
          beforeQuantity: compartment.stockQuantity,
          afterQuantity: desiredQuantity,
          details: { note: note?.trim() || null },
        },
      });
    });
  }

  async moveLocation(compartmentId: string, drawerId: string, actor: InventoryActor) {
    return this.db.$transaction(async (tx) => {
      const compartment = await tx.inventoryCompartment.findUnique({ where: { id: compartmentId }, include: { drawer: { include: { shelf: true } } } });
      const drawer = await tx.inventoryDrawer.findUnique({ where: { id: drawerId }, include: { shelf: true } });
      if (!compartment || !drawer) throw new ApiError(404, '在庫区画または移動先が見つかりません');
      await tx.inventoryCompartment.update({ where: { id: compartmentId }, data: { drawerId } });
      return tx.inventoryTransaction.create({
        data: {
          action: InventoryTransactionAction.LOCATION_CHANGE,
          inventoryItemId: compartment.inventoryItemId,
          compartmentId,
          clientId: actor.clientId ?? null,
          performedByUserId: actor.performedByUserId ?? null,
          beforeQuantity: compartment.stockQuantity,
          afterQuantity: compartment.stockQuantity,
          details: { from: `${compartment.drawer.shelf.area}/${compartment.drawer.shelf.shelfNumber}/${compartment.drawer.drawerNumber}`, to: `${drawer.shelf.area}/${drawer.shelf.shelfNumber}/${drawer.drawerNumber}` },
        },
      });
    });
  }

  async replaceItemTag(compartmentId: string, uid: string, actor: InventoryActor) {
    const cleanUid = uid.trim();
    if (!cleanUid) throw new ApiError(400, 'NFC UIDを指定してください');
    return this.db.$transaction(async (tx) => {
      const compartment = await tx.inventoryCompartment.findUnique({ where: { id: compartmentId }, include: { itemTag: true } });
      if (!compartment) throw new ApiError(404, '在庫区画が見つかりません');
      await this.assertNfcUidAvailable(cleanUid, tx);
      const existing = await tx.inventoryNfcTag.findUnique({ where: { uid: cleanUid } });
      if (existing && existing.compartmentId !== compartmentId) throw new ApiError(409, 'このUIDは既に使用されています');
      if (compartment.itemTag && compartment.itemTag.uid !== cleanUid) {
        await tx.inventoryNfcTag.update({ where: { id: compartment.itemTag.id }, data: { compartmentId: null } });
      }
      const tag = existing
        ? await tx.inventoryNfcTag.update({ where: { id: existing.id }, data: { kind: InventoryNfcTagKind.ITEM, compartmentId } })
        : await tx.inventoryNfcTag.create({ data: { uid: cleanUid, kind: InventoryNfcTagKind.ITEM, compartmentId } });
      await tx.inventoryTransaction.create({
        data: {
          action: InventoryTransactionAction.TAG_REPLACEMENT,
          inventoryItemId: compartment.inventoryItemId,
          compartmentId,
          clientId: actor.clientId ?? null,
          performedByUserId: actor.performedByUserId ?? null,
          beforeQuantity: compartment.stockQuantity,
          afterQuantity: compartment.stockQuantity,
          details: { previousUid: compartment.itemTag?.uid ?? null, uid: tag.uid },
        },
      });
      return tag;
    });
  }
}
