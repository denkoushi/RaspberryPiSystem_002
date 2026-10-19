import sharp from 'sharp';

import { logger } from '../../lib/logger.js';
import { PhotoStorage } from '../../lib/photo-storage.js';

import type { PrismaClient } from '@prisma/client';

async function deletePhotoFile(photoUrl: string) {
  try {
    await PhotoStorage.deletePhoto(photoUrl);
  } catch (error) {
    logger.warn({ err: error, photoUrl }, 'Inventory rotated photo file deletion failed');
  }
}

export async function rotateInventoryPhoto(db: PrismaClient, oldUrl: string, updatePhoto: (photoUrl: string) => Promise<void>) {
  const input = await PhotoStorage.readPhoto(oldUrl);
  const original = await sharp(input).rotate().rotate(90).jpeg({ quality: 90 }).toBuffer();
  const thumbnail = await sharp(original).resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  const { relativePath } = await PhotoStorage.savePhoto('inventory-import', original, thumbnail);
  try {
    await updatePhoto(relativePath);
  } catch (error) {
    await deletePhotoFile(relativePath);
    throw error;
  }
  const [registeredReferences, pendingReferences] = await Promise.all([
    db.inventoryItemPhoto.count({ where: { photoUrl: oldUrl } }),
    db.inventoryImportPhoto.count({ where: { photoUrl: oldUrl } }),
  ]);
  if (registeredReferences === 0 && pendingReferences === 0) await deletePhotoFile(oldUrl);
  return relativePath;
}
