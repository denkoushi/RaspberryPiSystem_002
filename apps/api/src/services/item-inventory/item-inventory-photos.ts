import { rotateInventoryPhoto } from './inventory-photo-rotation.js';
import { PrismaClient, InventoryImportPayloadStatus } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { PhotoStorage } from '../../lib/photo-storage.js';
import { runSerializable } from './item-inventory.helpers.js';

export async function rotateImportPhoto(db: PrismaClient, payloadId: string, photoId: string) {
  const payload = await db.inventoryImportPayload.findUnique({ where: { id: payloadId }, select: { status: true } });
  if (!payload) throw new ApiError(404, 'インポート候補が見つかりません');
  if (payload.status !== InventoryImportPayloadStatus.PENDING) throw new ApiError(409, '登録済みの候補は編集できません');
  const photo = await db.inventoryImportPhoto.findFirst({ where: { id: photoId, payloadId } });
  if (!photo) throw new ApiError(404, '写真が見つかりません');
  const photoUrl = await rotateInventoryPhoto(db, photo.photoUrl, (newUrl) => runSerializable(db, async (tx) => {
    const payload = await tx.inventoryImportPayload.findUnique({ where: { id: payloadId }, select: { status: true } });
    if (!payload) throw new ApiError(404, 'インポート候補が見つかりません');
    if (payload.status !== InventoryImportPayloadStatus.PENDING) throw new ApiError(409, '登録済みの候補は編集できません');
    const current = await tx.inventoryImportPhoto.findFirst({ where: { id: photoId, payloadId } });
    if (!current || current.photoUrl !== photo.photoUrl) throw new ApiError(409, '写真が更新されています。もう一度お試しください');
    await tx.inventoryImportPhoto.update({ where: { id: photoId }, data: { photoUrl: newUrl } });
  }));
  return { photoId, photoUrl };
}

export async function rotateInventoryItemPhoto(db: PrismaClient, itemId: string, photoId: string) {
  const photo = await db.inventoryItemPhoto.findFirst({ where: { id: photoId, inventoryItemId: itemId } });
  if (!photo) throw new ApiError(404, '登録済み写真が見つかりません');
  const photoUrl = await rotateInventoryPhoto(db, photo.photoUrl, (newUrl) => runSerializable(db, async (tx) => {
    const current = await tx.inventoryItemPhoto.findFirst({ where: { id: photoId, inventoryItemId: itemId } });
    if (!current || current.photoUrl !== photo.photoUrl) throw new ApiError(409, '写真が更新されています。もう一度お試しください');
    await tx.inventoryItemPhoto.update({ where: { id: photoId }, data: { photoUrl: newUrl } });
  }));
  return { photoId, photoUrl };
}

export async function deleteImportPhoto(db: PrismaClient, payloadId: string, photoId: string) {
  const result = await runSerializable(db, async (tx) => {
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

export async function reorderImportPhotos(db: PrismaClient, payloadId: string, photoIds: string[]) {
  await runSerializable(db, async (tx) => {
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

export async function deleteInventoryItemPhoto(db: PrismaClient, itemId: string, photoId: string) {
  const result = await runSerializable(db, async (tx) => {
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

export async function reorderInventoryItemPhotos(db: PrismaClient, itemId: string, photoIds: string[]) {
  await runSerializable(db, async (tx) => {
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
