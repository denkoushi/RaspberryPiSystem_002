import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, InventoryImportPayloadStatus, InventoryNfcTagKind, InventoryRegistrationMode, InventoryTransactionAction } from '@prisma/client';

import { prisma as defaultPrisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';

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
  inventoryItem: { id: string; itemCode: string; name: string; model: string | null; usage: string | null; category: string | null; area: string | null; note: string | null; photos?: Array<{ id: string; photoUrl: string; originalFilename: string }> };
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
            inventoryItem: { include: { photos: { orderBy: { createdAt: 'asc' } } } },
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
      orderBy: [{ name: 'asc' }, { itemCode: 'asc' }],
      include: {
        photos: { orderBy: { createdAt: 'asc' } },
        compartments: {
          include: { drawer: { include: { shelf: true } }, itemTag: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    return items.map(({ compartments, ...item }) => ({
      ...item,
      compartments: compartments.map((compartment) => locationDto({ ...compartment, inventoryItem: item })),
    }));
  }

  async listPendingImports() {
    return this.db.inventoryImportPayload.findMany({
      where: { status: InventoryImportPayloadStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      include: { photos: { orderBy: { photoIndex: 'asc' } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
  }

  async listImportMessages() {
    return this.db.inventoryImportMessage.findMany({ orderBy: { updatedAt: 'desc' }, take: 100 });
  }

  async listHistory(limit = 100) {
    return this.db.inventoryTransaction.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(limit, 1), 500),
      include: { inventoryItem: true, compartment: { include: { drawer: { include: { shelf: true } } } } },
    });
  }

  async createShelf(area: string, shelfNumber: number) {
    const trimmedArea = area.trim();
    if (!trimmedArea) throw new ApiError(400, 'エリアを指定してください');
    positiveInteger(shelfNumber, '棚番号');
    return this.db.inventoryShelf.upsert({
      where: { area_shelfNumber: { area: trimmedArea, shelfNumber } },
      create: { area: trimmedArea, shelfNumber },
      update: {},
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
    actor?: InventoryActor;
  }) {
    const payload = await this.db.inventoryImportPayload.findUnique({
      where: { id: input.payloadId },
      include: { photos: { orderBy: { photoIndex: 'asc' } } },
    });
    if (!payload) throw new ApiError(404, 'インポート候補が見つかりません');
    if (payload.status !== InventoryImportPayloadStatus.PENDING) throw new ApiError(409, 'この候補は処理済みです');
    if (input.mode === 'EXISTING_ITEM') {
      if (!input.itemId) throw new ApiError(400, '既存アイテムを選択してください');
      const item = await this.db.$transaction(async (tx) => {
        const existing = await tx.inventoryItem.findUnique({ where: { id: input.itemId } });
        if (!existing) throw new ApiError(404, '既存アイテムが見つかりません');
        const updated = await tx.inventoryItem.update({
          where: { id: existing.id },
          data: {
            ...(input.name?.trim() ? { name: input.name.trim() } : {}),
            ...(input.model !== undefined ? { model: input.model.trim() || null } : {}),
            ...(input.usage !== undefined ? { usage: input.usage.trim() || null } : {}),
            ...(payload.category !== null ? { category: payload.category } : {}),
            ...(payload.note !== null ? { note: payload.note } : {}),
          },
        });
        for (const photo of payload.photos) {
          const already = await tx.inventoryItemPhoto.findFirst({ where: { inventoryItemId: existing.id, sha256: photo.sha256 } });
          if (!already) {
            await tx.inventoryItemPhoto.create({
              data: {
                inventoryItemId: existing.id,
                photoUrl: photo.photoUrl,
                originalFilename: photo.filename,
                sha256: photo.sha256,
                sourcePayloadId: payload.id,
              },
            });
          }
        }
        await tx.inventoryImportPayload.update({
          where: { id: payload.id },
          data: {
            status: InventoryImportPayloadStatus.REGISTERED,
            registrationMode: InventoryRegistrationMode.EXISTING_ITEM,
            registeredItemId: existing.id,
            reviewedAt: new Date(),
            reviewNote: input.reviewNote?.trim() || null,
          },
        });
        return updated;
      });
      return { mode: input.mode, item };
    }
    if (!input.shelfId || !input.drawerId || !input.itemTagUid) {
      throw new ApiError(400, 'エリア、棚、引き出し、アイテムNFCタグを指定してください');
    }
    const initialQuantity = nonNegativeInteger(input.initialQuantity ?? 0, '初期数量');
    const cleanName = input.name?.trim() || `ItemlistRaspi ${payload.sourceItemId}`;
    const cleanUid = input.itemTagUid.trim();
    if (!cleanUid) throw new ApiError(400, 'アイテムNFC UIDを指定してください');
    const result = await this.db.$transaction(async (tx) => {
      const drawer = await tx.inventoryDrawer.findUnique({ where: { id: input.drawerId }, include: { shelf: true } });
      if (!drawer || drawer.shelfId !== input.shelfId) throw new ApiError(400, '棚と引き出しの組み合わせが不正です');
      if (drawer.shelf.area !== payload.area) throw new ApiError(400, 'JSONのエリアと棚のエリアが一致しません');
      await this.assertNfcUidAvailable(cleanUid, tx);
      const existingTag = await tx.inventoryNfcTag.findUnique({ where: { uid: cleanUid } });
      if (existingTag && (existingTag.kind !== InventoryNfcTagKind.ITEM || existingTag.compartmentId)) {
        throw new ApiError(409, 'このUIDは既に使用されています');
      }
      const item = await tx.inventoryItem.create({
        data: {
          itemCode: newItemCode(payload.sourceItemId),
          name: cleanName,
          model: input.model?.trim() || null,
          usage: input.usage?.trim() || null,
          category: payload.category,
          area: payload.area,
          note: payload.note,
          photos: {
            create: payload.photos.map((photo) => ({
              photoUrl: photo.photoUrl,
              originalFilename: photo.filename,
              sha256: photo.sha256,
              sourcePayloadId: payload.id,
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
          details: { sourcePayloadId: payload.id, itemTagUid: cleanUid },
        },
      });
      await tx.inventoryImportPayload.update({
        where: { id: payload.id },
        data: {
          status: InventoryImportPayloadStatus.REGISTERED,
          registrationMode: InventoryRegistrationMode.NEW_ITEM,
          registeredItemId: item.id,
          reviewedAt: new Date(),
          reviewNote: input.reviewNote?.trim() || null,
        },
      });
      return { item, compartment };
    });
    return { mode: input.mode, ...result };
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
    let result;
    try {
      result = await this.serializable(async (tx) => {
      if (input.idempotencyKey && input.actor?.clientId) {
        const prior = await tx.inventoryTransaction.findFirst({ where: { clientId: input.actor.clientId, idempotencyKey: input.idempotencyKey } });
        if (prior) return { transaction: prior, replayed: true };
      }
      const itemTag = await tx.inventoryNfcTag.findUnique({ where: { uid: itemUid }, include: { compartment: true } });
      if (!itemTag || itemTag.kind !== InventoryNfcTagKind.ITEM || !itemTag.compartmentId) throw new ApiError(400, 'アイテムNFCタグを読み取ってください');
      if (input.restock) {
        const commandTag = await tx.inventoryNfcTag.findUnique({ where: { uid: commandUid! } });
        if (!commandTag || commandTag.kind !== InventoryNfcTagKind.RESTOCK) throw new ApiError(400, '補充NFCタグが不正です');
      }
      const quantityTag = await tx.inventoryNfcTag.findUnique({ where: { uid: quantityUid } });
      if (!quantityTag || quantityTag.kind !== InventoryNfcTagKind.QUANTITY || !quantityTag.quantity) throw new ApiError(400, '数量NFCタグを読み取ってください');
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "InventoryCompartment" WHERE "id" = ${itemTag.compartmentId} FOR UPDATE`);
      const compartment = await tx.inventoryCompartment.findUnique({ where: { id: itemTag.compartmentId } });
      if (!compartment) throw new ApiError(404, '在庫区画が見つかりません');
      const delta = input.restock ? quantityTag.quantity : -quantityTag.quantity;
      const afterQuantity = compartment.stockQuantity + delta;
      if (afterQuantity < 0) throw new InventoryInsufficientStockError();
      const action = input.restock ? InventoryTransactionAction.RESTOCK : InventoryTransactionAction.ISSUE;
      const updated = await tx.inventoryCompartment.update({ where: { id: compartment.id }, data: { stockQuantity: afterQuantity } });
      const transaction = await tx.inventoryTransaction.create({
        data: {
          action,
          inventoryItemId: compartment.inventoryItemId,
          compartmentId: compartment.id,
          clientId: input.actor?.clientId ?? null,
          performedByUserId: input.actor?.performedByUserId ?? null,
          quantityTagId: quantityTag.id,
          idempotencyKey: input.idempotencyKey ?? null,
          delta,
          beforeQuantity: compartment.stockQuantity,
          afterQuantity: updated.stockQuantity,
          details: { itemTagUid: itemUid, quantityTagUid: quantityUid, restockTagUid: commandUid ?? null },
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
      await tx.inventoryCompartment.update({ where: { id: compartment.id }, data: { stockQuantity: afterQuantity } });
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

  async correctStock(compartmentId: string, desiredQuantity: number, actor: InventoryActor, note?: string) {
    nonNegativeInteger(desiredQuantity, '在庫数');
    return this.serializable(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "InventoryCompartment" WHERE "id" = ${compartmentId} FOR UPDATE`);
      const compartment = await tx.inventoryCompartment.findUnique({ where: { id: compartmentId } });
      if (!compartment) throw new ApiError(404, '在庫区画が見つかりません');
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
