/**
 * Gmail 吊具点検 CSV の誤投影を修復する backfill。
 * notes.source=gmail の既存記録を削除し、CsvDashboard 永続行から再投影する。
 *
 * ローカル:
 *   pnpm --filter @raspi-system/api backfill:rigging-inspection-gmail-projection
 *   pnpm --filter @raspi-system/api backfill:rigging-inspection-gmail-projection -- --dry-run
 *
 * 本番（Pi5 API コンテナ内）:
 *   docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api pnpm backfill:rigging-inspection-gmail-projection:prod --dry-run
 *   docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api pnpm backfill:rigging-inspection-gmail-projection:prod
 */

import { prisma } from '../lib/prisma.js';
import { loadRiggingInspectionSourceRowsFromDashboard } from '../services/rigging/inspection/rigging-inspection-sync.pipeline.js';
import { RiggingInspectionProjectionService } from '../services/rigging/inspection/rigging-inspection-projection.service.js';

function isGmailSourcedNotes(notes: string | null | undefined): boolean {
  if (!notes) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(notes);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return (parsed as { source?: unknown }).source === 'gmail';
    }
  } catch {
    return false;
  }
  return false;
}

async function countGmailSourcedRecords(): Promise<number> {
  const records = await prisma.riggingInspectionRecord.findMany({
    where: { notes: { not: null } },
    select: { id: true, notes: true },
  });
  return records.filter((record) => isGmailSourcedNotes(record.notes)).length;
}

async function deleteGmailSourcedRecords(dryRun: boolean): Promise<number> {
  const records = await prisma.riggingInspectionRecord.findMany({
    where: { notes: { not: null } },
    select: { id: true, notes: true },
  });
  const ids = records.filter((record) => isGmailSourcedNotes(record.notes)).map((record) => record.id);
  if (dryRun || ids.length === 0) {
    return ids.length;
  }
  const deleted = await prisma.riggingInspectionRecord.deleteMany({
    where: { id: { in: ids } },
  });
  return deleted.count;
}

async function main(): Promise<number> {
  const dryRun = process.argv.includes('--dry-run');
  const { scanned } = await loadRiggingInspectionSourceRowsFromDashboard(prisma);
  const gmailRecordCount = await countGmailSourcedRecords();

  console.log('[backfill-rigging-inspection-gmail-projection] dryRun=', dryRun);
  console.log('[backfill-rigging-inspection-gmail-projection] gmail records to delete=', gmailRecordCount);
  console.log('[backfill-rigging-inspection-gmail-projection] dashboard rows to scan=', scanned);

  if (dryRun) {
    return 0;
  }

  const deletedCount = await deleteGmailSourcedRecords(false);
  console.log('[backfill-rigging-inspection-gmail-projection] deleted gmail records=', deletedCount);

  const service = new RiggingInspectionProjectionService();
  const result = await service.syncFromPersistedDashboardRows();
  console.log('[backfill-rigging-inspection-gmail-projection] Done:', JSON.stringify(result));
  return 0;
}

void main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error('[backfill-rigging-inspection-gmail-projection] Error:', err);
    process.exitCode = 1;
  })
  .finally(() =>
    prisma.$disconnect().catch(() => {
      /* ignore */
    })
  );
