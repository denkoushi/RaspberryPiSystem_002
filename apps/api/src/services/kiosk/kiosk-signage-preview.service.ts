import { prisma } from '../../lib/prisma.js';

export type SignagePreviewCandidateDevice = {
  id: string;
  name: string;
  location: string | null;
  apiKey: string;
};

export async function listSignagePreviewCandidates(): Promise<SignagePreviewCandidateDevice[]> {
  return prisma.clientDevice.findMany({
    where: {
      apiKey: {
        contains: 'signage',
        mode: 'insensitive'
      }
    },
    select: { id: true, name: true, location: true, apiKey: true },
    orderBy: { name: 'asc' }
  });
}

export async function getSignagePreviewTarget(
  clientDeviceId: string
): Promise<{ signagePreviewTargetApiKey: string | null } | null> {
  return prisma.clientDevice.findUnique({
    where: { id: clientDeviceId },
    select: { signagePreviewTargetApiKey: true }
  });
}

export async function clearSignagePreviewTarget(clientDeviceId: string): Promise<void> {
  await prisma.clientDevice.update({
    where: { id: clientDeviceId },
    data: { signagePreviewTargetApiKey: null }
  });
}

export async function setSignagePreviewTarget(
  clientDeviceId: string,
  targetClientDeviceId: string
): Promise<void> {
  await prisma.clientDevice.update({
    where: { id: clientDeviceId },
    // Keep the existing column/schema; new selections persist a non-secret ID.
    data: { signagePreviewTargetApiKey: targetClientDeviceId }
  });
}

/** Legacy key-valued rows are converted at this persistence boundary without a write. */
export function resolveSignagePreviewTargetClientDeviceId(
  storedTarget: string | null,
  candidates: SignagePreviewCandidateDevice[]
): string | null {
  if (!storedTarget) return null;
  return candidates.find((candidate) => candidate.id === storedTarget || candidate.apiKey === storedTarget)?.id ?? null;
}
