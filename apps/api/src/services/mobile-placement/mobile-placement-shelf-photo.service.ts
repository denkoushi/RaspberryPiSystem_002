import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

async function requireShelf(shelfCodeRaw: string) {
  const shelf = await prisma.mobilePlacementShelf.findUnique({ where: { shelfCodeRaw }, select: { id: true } });
  if (!shelf) throw new ApiError(404, '棚が見つかりません');
  return shelf;
}

export async function putShelfPhoto(shelfCodeRaw: string, input: { contentType: string; dataBase64: string }, clientDeviceId: string) {
  if (input.dataBase64.length > 1_398_104) throw new ApiError(400, '写真は1MB以下にしてください');
  const bytes = Buffer.from(input.dataBase64, 'base64');
  if (bytes.length === 0 || bytes.length > 1024 * 1024) throw new ApiError(400, '写真は1MB以下にしてください');
  if (bytes.toString('base64') !== input.dataBase64) throw new ApiError(400, '写真の形式が正しくありません');
  const matches = input.contentType === 'image/jpeg' ? bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    : input.contentType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : input.contentType === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!matches) throw new ApiError(400, '写真の形式が一致しません');
  const shelf = await requireShelf(shelfCodeRaw);
  const data = { contentType: input.contentType, bytes, byteSize: bytes.length, updatedByClientDeviceId: clientDeviceId };
  const photo = await prisma.mobilePlacementShelfPhoto.upsert({
    where: { shelfId: shelf.id }, create: { shelfId: shelf.id, ...data }, update: data,
    select: { updatedAt: true }
  });
  return { photoUpdatedAt: photo.updatedAt.toISOString() };
}

export async function getShelfPhoto(shelfCodeRaw: string) {
  const shelf = await requireShelf(shelfCodeRaw);
  const photo = await prisma.mobilePlacementShelfPhoto.findUnique({ where: { shelfId: shelf.id } });
  if (!photo) throw new ApiError(404, '棚の写真がありません');
  return photo;
}

export async function updateShelfMemo(shelfCodeRaw: string, displayLabel: string | null) {
  const shelf = await requireShelf(shelfCodeRaw);
  const memo = displayLabel?.trim() || null;
  if (memo && memo.length > 60) throw new ApiError(400, 'メモは60文字以下にしてください');
  return prisma.mobilePlacementShelf.update({
    where: { id: shelf.id }, data: { displayLabel: memo }, select: { shelfCodeRaw: true, displayLabel: true }
  });
}
