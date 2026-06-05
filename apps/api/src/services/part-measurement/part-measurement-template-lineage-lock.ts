import type {
  PartMeasurementProcessGroup,
  PartMeasurementTemplateScope,
  Prisma
} from '@prisma/client';

import { normalizeFhincd } from './template-candidate-rules.js';

/** pg_advisory_xact_lock の namespace（部品測定 THREE_KEY 本番系譜） */
export const PART_MEASUREMENT_TEMPLATE_LINEAGE_LOCK_NS = 824_001;

export function buildThreeKeyLineageLockKey(
  fhincd: string,
  processGroup: PartMeasurementProcessGroup,
  resourceCd: string
): string {
  return `${normalizeFhincd(fhincd)}|${processGroup}|${resourceCd}`;
}

/** 品番×工程×資源CD の本番 THREE_KEY 系譜（評価用 CANDIDATE_* バケットは対象外） */
export function isProductionThreeKeyLineage(
  templateScope: PartMeasurementTemplateScope,
  processGroup: PartMeasurementProcessGroup
): boolean {
  return (
    templateScope === 'THREE_KEY' && (processGroup === 'CUTTING' || processGroup === 'GRINDING')
  );
}

/**
 * 同一 fhincd+processGroup+resourceCd（THREE_KEY 本番系譜）の版作成・改版・有効版切替を直列化する。
 * failIfActiveExists の競合判定と version 採番の同時実行を防ぐ。
 */
export async function acquireThreeKeyLineageTransactionLock(
  tx: Prisma.TransactionClient,
  fhincd: string,
  processGroup: PartMeasurementProcessGroup,
  resourceCd: string
): Promise<void> {
  const lineageKey = buildThreeKeyLineageLockKey(fhincd, processGroup, resourceCd);
  // 2 引数版は (int4, int4) のみ。Prisma バインドは bigint になり得るため明示 cast する。
  // pg_advisory_xact_lock は void を返すため $queryRaw では P2010 になる。副作用のみなので $executeRaw を使う。
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PART_MEASUREMENT_TEMPLATE_LINEAGE_LOCK_NS}::int4, hashtext(${lineageKey}::text)::int4)`;
}
