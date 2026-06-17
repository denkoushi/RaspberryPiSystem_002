import type { Prisma } from '@prisma/client';

import { PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID } from './constants.js';

/**
 * FKOJUNST_Status mail ingest と fkmail 投影を同一 advisory キーで直列化する。
 * pg_advisory_xact_lock は void を返すため $queryRaw では P2010 になる。副作用のみなので $executeRaw を使う。
 */
export async function acquireFkojunstStatusMailCriticalTransactionLock(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext('fkojunst-status-mail-critical'),
      hashtext(${PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID})
    )
  `;
}
