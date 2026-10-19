import type { Prisma } from '@prisma/client';
import { deriveProcedureManualKanaRow, normalizeProcedureManualCommonSubject } from '@raspi-system/shared-types';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { runAssemblyTransaction } from './assembly-transaction.js';

export const COMMON_PARENT_ID = 'procedure-manual-common';

// All common catalog/assignment mutations take this lock before category/document locks.
export async function lockProcedureManualCommon(tx: Prisma.TransactionClient) {
  // The parent row does not exist on the first seed; serialize that case too.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${COMMON_PARENT_ID}))`;
  await tx.$queryRaw`SELECT id FROM "ProcedureManualProcess" WHERE id = ${COMMON_PARENT_ID} FOR UPDATE`;
}

export async function ensureProcedureManualCommonSeeded(transaction?: Prisma.TransactionClient) {
  const db = transaction ?? prisma;
  const parent = { where: { id: COMMON_PARENT_ID }, select: { id: true } };
  if (await db.procedureManualProcess.findUnique(parent)) return;
  const seed = async (tx: Prisma.TransactionClient) => {
    await lockProcedureManualCommon(tx);
    if (await tx.procedureManualProcess.findUnique(parent)) return;
    await tx.procedureManualProcess.create({ data: { id: COMMON_PARENT_ID, name: '共通', subjectKind: 'COMMON', sortOrder: 20 } });
    await tx.procedureManualProcess.createMany({ data: [
      ['tools', '工具'], ['cleaning', '清掃'], ['maintenance', '点検・保全'],
      ['safety', '安全'], ['setup', '段取り'], ['other', 'その他']
    ].map(([id, name], sortOrder) => ({ id: `${COMMON_PARENT_ID}-${id}`, parentId: COMMON_PARENT_ID, name, subjectKind: 'COMMON', sortOrder })) });
    await tx.procedureManualCommonAction.createMany({ data: [
      ['use', '使い方'], ['clean', '清掃'], ['inspect', '点検'],
      ['replace', '交換'], ['calibrate', '校正'], ['tidy', '片付け']
    ].map(([id, name], sortOrder) => ({ id: `${COMMON_PARENT_ID}-action-${id}`, name, sortOrder })) });
  };
  if (transaction) await seed(transaction); else await runAssemblyTransaction(seed);
}

export function procedureManualCommonKey(name: string) {
  const key = normalizeProcedureManualCommonSubject(name);
  if (key.length > 200) throw new ApiError(400, '対象が長すぎます');
  return key;
}

export async function ensureProcedureManualCommonSubject(tx: Prisma.TransactionClient, name: string, kanaRow?: string | null) {
  const key = procedureManualCommonKey(name);
  const known = await tx.procedureManualCommonSubject.findUnique({ where: { key } });
  const row = deriveProcedureManualKanaRow(name) ?? known?.kanaRow ?? kanaRow;
  if (!row) throw new ApiError(400, 'よみを選んでください');
  return tx.procedureManualCommonSubject.upsert({
    where: { key }, create: { key, name: name.trim(), kanaRow: row }, update: { kanaRow: row }
  });
}
