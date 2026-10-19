import { PrismaClient, InventoryImportPayloadStatus, InventoryNfcTagKind, InventoryRegistrationMode, InventoryTransactionAction } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';
import { toolData } from './item-inventory.fields.js';
import type { InventoryActor } from './item-inventory.errors.js';
import { nonNegativeInteger, newItemCode, assertNfcUidAvailable, runSerializable, resolveUnit } from './item-inventory.helpers.js';

export async function registerImport(db: PrismaClient, input: {
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
  const unit = input.unit === undefined ? undefined : await resolveUnit(db, input.unit);
  if (input.mode === 'NEW_ITEM' && !cleanUid) throw new ApiError(400, 'アイテムNFC UIDを指定してください');

  return runSerializable(db, async (tx) => {
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
    await assertNfcUidAvailable(cleanUid, tx);
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
