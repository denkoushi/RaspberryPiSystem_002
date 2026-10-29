import { Prisma, PrismaClient, InventoryNfcTagKind, InventoryTransactionAction } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';
import { TRANSACTION_INCLUDE, positiveInteger, nonNegativeInteger, assertNfcUidAvailable, runSerializable } from './item-inventory.helpers.js';
import { InventoryInsufficientStockError, InventoryConflictError } from './item-inventory.errors.js';
import type { InventoryActor } from './item-inventory.errors.js';

export async function bindCompartment(db: PrismaClient, input: {
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
  return db.$transaction(async (tx) => {
    const [item, drawer] = await Promise.all([
      tx.inventoryItem.findUnique({ where: { id: input.itemId } }),
      tx.inventoryDrawer.findUnique({ where: { id: input.drawerId }, include: { shelf: true } }),
    ]);
    if (!item) throw new ApiError(404, '既存アイテムが見つかりません');
    if (item.deletedAt) throw new ApiError(404, '既存アイテムが見つかりません');
    if (!drawer || drawer.shelfId !== input.shelfId) throw new ApiError(400, '棚と引き出しの組み合わせが不正です');
    await assertNfcUidAvailable(cleanUid, tx);
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

export async function processTransaction(db: PrismaClient, input: {
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
  return processStockTransaction(db, input, async (tx) => {
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

export async function processTouchTransaction(db: PrismaClient, input: {
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
  return processStockTransaction(db, input, async () => ({
    compartmentId: input.compartmentId,
    quantity: input.quantity,
    details: { source: 'touch' },
  }));
}

export async function processStockTransaction(
  db: PrismaClient,
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
    result = await runSerializable(db, async (tx) => {
      if (input.idempotencyKey && input.actor?.clientId) {
        const prior = await tx.inventoryTransaction.findFirst({ where: { clientId: input.actor.clientId, idempotencyKey: input.idempotencyKey }, include: TRANSACTION_INCLUDE });
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
        include: TRANSACTION_INCLUDE,
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
      const prior = await db.inventoryTransaction.findFirst({ where: { clientId: input.actor.clientId, idempotencyKey: input.idempotencyKey }, include: TRANSACTION_INCLUDE });
      if (prior) return { transaction: prior, replayed: true };
    }
    throw error;
  }
  return result;
}

export async function cancelTransaction(db: PrismaClient, id: string, actor: InventoryActor, options: { allowAnyClient?: boolean } = {}) {
  return runSerializable(db, async (tx) => {
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
      include: TRANSACTION_INCLUDE,
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

export async function correctStock(
  db: PrismaClient,
  compartmentId: string,
  desiredQuantity: number,
  actor: InventoryActor,
  note?: string,
  options: { expectedBeforeQuantity?: number } = {},
) {
  nonNegativeInteger(desiredQuantity, '在庫数');
  return runSerializable(db, async (tx) => {
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

export async function moveLocation(db: PrismaClient, compartmentId: string, drawerId: string, actor: InventoryActor) {
  return db.$transaction(async (tx) => {
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

export async function replaceItemTag(db: PrismaClient, compartmentId: string, uid: string, actor: InventoryActor) {
  const cleanUid = uid.trim();
  if (!cleanUid) throw new ApiError(400, 'NFC UIDを指定してください');
  return db.$transaction(async (tx) => {
    const compartment = await tx.inventoryCompartment.findUnique({ where: { id: compartmentId }, include: { itemTag: true } });
    if (!compartment) throw new ApiError(404, '在庫区画が見つかりません');
    await assertNfcUidAvailable(cleanUid, tx);
    const existing = await tx.inventoryNfcTag.findUnique({
      where: { uid: cleanUid },
      include: { compartment: { include: { inventoryItem: true, drawer: { include: { shelf: true } } } } },
    });
    if (existing && existing.compartmentId !== compartmentId) {
      const used = existing.compartment;
      throw new ApiError(409, 'このUIDは既に使用されています', used ? { usedBy: {
        itemName: used.inventoryItem.name, area: used.drawer.shelf.area,
        shelfNumber: used.drawer.shelf.shelfNumber, drawerNumber: used.drawer.drawerNumber,
      } } : undefined);
    }
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
