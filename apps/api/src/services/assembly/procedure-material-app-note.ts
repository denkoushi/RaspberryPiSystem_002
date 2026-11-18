import type { Prisma, ProcedureMaterial } from '@prisma/client';

import { materialAppText, normalizeEmployeeNumber } from './procedure-material-employee-number.js';

export function buildProcedureMaterialAppNote(
  photo: Pick<ProcedureMaterial, 'origin' | 'appRef' | 'gmailMessageId' | 'subjectHint' | 'fromEmail' | 'receivedAt'>,
) {
  const { appRef, gmailMessageId, subjectHint, fromEmail, receivedAt } = photo;
  if (gmailMessageId === null || !appRef || typeof appRef !== 'object' || Array.isArray(appRef)) return null;
  const text = materialAppText(photo, 'note')?.trim();
  if (!text || normalizeEmployeeNumber(materialAppText(photo, 'nameId')) === null) return null;
  return {
    origin: 'APP', kind: 'TEXT', text, appRef: { ...appRef, photoIndex: 0 },
    gmailMessageId, gmailDedupeKey: `${gmailMessageId}:app-note`, subjectHint, fromEmail, receivedAt,
  } satisfies Prisma.ProcedureMaterialCreateManyInput;
}
