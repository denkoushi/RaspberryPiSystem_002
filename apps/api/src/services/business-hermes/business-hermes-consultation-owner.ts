import type { PrismaClient, UserRole } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';

export type BusinessHermesConsultationActor = {
  userId: string;
  role: UserRole;
};

export type BusinessHermesConsultationCaller =
  | { kind: 'user'; userId: string; role: UserRole }
  | { kind: 'device'; clientDeviceId: string };

export function assertConsultationOwner(row: { createdByUserId: string | null; createdByClientDeviceId: string | null }, caller: BusinessHermesConsultationCaller): void {
  const legacy = row.createdByUserId === null && row.createdByClientDeviceId === null;
  const allowed = caller.kind === 'user'
    ? caller.role === 'ADMIN' || (caller.role === 'MANAGER' && (row.createdByUserId === caller.userId || legacy))
    : row.createdByClientDeviceId === caller.clientDeviceId;
  if (!allowed) throw new ApiError(403, 'この相談は作成した利用者か端末だけが変更できます', undefined, 'BUSINESS_HERMES_CONSULTATION_NOT_OWNER');
}


/** Loads only the owner columns; false when the consultation does not exist. */
export async function assertConsultationWritable(db: Pick<PrismaClient, 'businessHermesConsultation'>, id: string, caller: BusinessHermesConsultationCaller): Promise<boolean> {
  const row = await db.businessHermesConsultation.findUnique({
    where: { id },
    select: { createdByUserId: true, createdByClientDeviceId: true }
  });
  if (!row) return false;
  assertConsultationOwner(row, caller);
  return true;
}
