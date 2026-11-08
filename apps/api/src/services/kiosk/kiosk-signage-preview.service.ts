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

export async function getSignagePreviewTarget(clientDeviceId: string) {
  return prisma.clientDevice.findUnique({
    where: { id: clientDeviceId },
    select: { signagePreviewTargetDeviceId: true }
  });
}

export async function resolveSignagePreviewTargetInput(input: {
  signagePreviewTargetDeviceId?: string | null;
  signagePreviewTargetApiKey?: string | null;
}): Promise<{ signagePreviewTargetDeviceId: string | null; signagePreviewTargetApiKey: string | null }> {
  const id = input.signagePreviewTargetDeviceId;
  const target = id !== undefined ? id : input.signagePreviewTargetApiKey;
  if (target == null) return { signagePreviewTargetDeviceId: null, signagePreviewTargetApiKey: null };
  const device = await prisma.clientDevice.findUnique({
    where: id !== undefined ? { id: target } : { apiKey: target },
    select: { id: true, isSignage: true }
  });
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
