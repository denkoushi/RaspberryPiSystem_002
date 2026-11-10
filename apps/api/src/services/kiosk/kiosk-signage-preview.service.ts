import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';

export type SignagePreviewCandidateDevice = {
  id: string;
  name: string;
  location: string | null;
};

export async function listSignagePreviewCandidates(): Promise<SignagePreviewCandidateDevice[]> {
  return prisma.clientDevice.findMany({
    where: { isSignage: true },
    select: { id: true, name: true, location: true },
    orderBy: { name: 'asc' }
  });
}

function resolveStoredSignagePreviewTarget(row: {
  signagePreviewTargetDeviceId: string | null;
  signagePreviewTargetApiKey: string | null;
}): string | null {
  return row.signagePreviewTargetDeviceId === row.signagePreviewTargetApiKey
    ? row.signagePreviewTargetDeviceId
    : row.signagePreviewTargetApiKey;
}

export async function getSignagePreviewTarget(clientDeviceId: string) {
  const row = await prisma.clientDevice.findUnique({
    where: { id: clientDeviceId },
    select: { signagePreviewTargetDeviceId: true, signagePreviewTargetApiKey: true }
  });
  if (!row) return null;
  const stored = resolveStoredSignagePreviewTarget(row);
  if (stored === null || stored === row.signagePreviewTargetDeviceId) return { signagePreviewTargetDeviceId: stored };
  // Older versions may have stored a key instead of an ID.
  const device = await prisma.clientDevice.findFirst({
    where: { OR: [{ id: stored }, { apiKey: stored }] },
    select: { id: true }
  });
  return { signagePreviewTargetDeviceId: device?.id ?? null };
}

export async function resolveSignagePreviewTargetInput(input: {
  signagePreviewTargetDeviceId?: string | null;
  signagePreviewTargetApiKey?: string | null;
}): Promise<{ signagePreviewTargetDeviceId: string | null; signagePreviewTargetApiKey: string | null }> {
  if (input.signagePreviewTargetApiKey !== undefined) {
    throw new ApiError(400, '端末 ID で指定してください', undefined, 'INVALID_SIGNAGE_PREVIEW_TARGET');
  }
  const target = input.signagePreviewTargetDeviceId;
  if (target == null) return { signagePreviewTargetDeviceId: null, signagePreviewTargetApiKey: null };
  const select = { id: true, isSignage: true } as const;
  const device = await prisma.clientDevice.findUnique({ where: { id: target }, select });
  if (!device?.isSignage) {
    throw new ApiError(400, '登録済みサイネージ端末のみ選択できます', undefined, 'INVALID_SIGNAGE_PREVIEW_TARGET');
  }
  // The legacy column keeps an ID, which older versions already read.
  return { signagePreviewTargetDeviceId: device.id, signagePreviewTargetApiKey: device.id };
}

export async function clearSignagePreviewTarget(clientDeviceId: string): Promise<void> {
  await prisma.clientDevice.update({
    where: { id: clientDeviceId },
    data: { signagePreviewTargetDeviceId: null, signagePreviewTargetApiKey: null }
  });
}

export async function setSignagePreviewTarget(clientDeviceId: string, targetClientDeviceId: string): Promise<void> {
  const target = await resolveSignagePreviewTargetInput({ signagePreviewTargetDeviceId: targetClientDeviceId });
  await prisma.clientDevice.update({ where: { id: clientDeviceId }, data: target });
}

export function resolveSignagePreviewTargetClientDeviceId(
  storedTarget: string | null,
  candidates: SignagePreviewCandidateDevice[]
): string | null {
  return candidates.find((candidate) => candidate.id === storedTarget)?.id ?? null;
}
