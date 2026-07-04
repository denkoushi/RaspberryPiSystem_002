import { prisma } from '../../lib/prisma.js';
import { findClientDeviceIdRecordByApiKey } from '../clients/client-device-auth.service.js';

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
  targetApiKey: string
): Promise<void> {
  await prisma.clientDevice.update({
    where: { id: clientDeviceId },
    data: { signagePreviewTargetApiKey: targetApiKey }
  });
}

export async function findSignagePreviewTargetDeviceByApiKey(
  targetApiKey: string
): Promise<{ id: string } | null> {
  return findClientDeviceIdRecordByApiKey(targetApiKey);
}
