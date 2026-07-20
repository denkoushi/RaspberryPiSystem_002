import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import {
  lockAssemblyWorkSession,
  type AssemblyTransactionClient
} from './assembly-work-session-lock.repository.js';

import type { AssemblyWorkSessionDetail } from './assembly-work-session-detail.js';

/**
 * 組立業務の interactive transaction 共通予算。
 *
 * maxWait は接続プールから transaction を開始するまで、timeout は開始後の
 * DB ロック待ちと callback 全体に対する上限であり、どちらも無制限にはしない。
 */
export const ASSEMBLY_TRANSACTION_OPTIONS = Object.freeze({
  maxWait: 15_000,
  timeout: 30_000
});

export type AssemblyTransactionWork<T> = (tx: Prisma.TransactionClient) => Promise<T>;

/** 組立ドメインの interactive transaction を共通予算で実行する。 */
export function runAssemblyTransaction<T>(work: AssemblyTransactionWork<T>): Promise<T> {
  return prisma.$transaction(work, ASSEMBLY_TRANSACTION_OPTIONS);
}

/**
 * 作業セッションを行ロックしてから更新する全経路の単一入口。
 * LEGACY／REQUIRED の双方で同じ直列化と transaction 予算を保証する。
 */
export function runLockedAssemblyWorkSessionTransaction<T>(
  sessionId: string,
  work: (tx: AssemblyTransactionClient, session: AssemblyWorkSessionDetail) => Promise<T>
): Promise<T> {
  return runAssemblyTransaction(async (tx) => {
    const session = await lockAssemblyWorkSession(tx, sessionId);
    return work(tx, session);
  });
}
