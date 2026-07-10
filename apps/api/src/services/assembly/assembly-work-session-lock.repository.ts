import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import {
  assemblyWorkSessionDetailInclude,
  type AssemblyWorkSessionDetail,
} from './assembly-work-session-detail.js';

export type AssemblyTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export async function lockAssemblyWorkSession(
  tx: AssemblyTransactionClient,
  sessionId: string,
): Promise<AssemblyWorkSessionDetail> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "AssemblyWorkSession" WHERE id = ${sessionId} FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new ApiError(404, '作業セッションが見つかりません');
  }
  const session = await tx.assemblyWorkSession.findUnique({
    where: { id: sessionId },
    include: assemblyWorkSessionDetailInclude,
  });
  if (!session) {
    throw new ApiError(404, '作業セッションが見つかりません');
  }
  return session;
}
