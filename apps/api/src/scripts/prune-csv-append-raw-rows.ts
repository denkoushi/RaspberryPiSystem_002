/** Default: --dry-run. Writes only with --execute (at most 20,000 rows per dashboard). */
import { prisma } from '../lib/prisma.js';
import {
  APPEND_RAW_ROW_PRUNE_DASHBOARD_IDS,
  CsvDashboardAppendRawRowPruneService,
} from '../services/csv-dashboard/csv-dashboard-append-raw-row-prune.service.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--dry-run' && arg !== '--execute') ||
      (args.includes('--dry-run') && args.includes('--execute'))) {
    throw new Error('Usage: prune:csv-append-raw-rows [--dry-run | --execute]');
  }
  const execute = args.includes('--execute');
  const service = new CsvDashboardAppendRawRowPruneService();
  for (const dashboardId of APPEND_RAW_ROW_PRUNE_DASHBOARD_IDS) {
    const before = await service.count(dashboardId);
    const result = execute ? await service.prune(dashboardId) : undefined;
    if (result?.failed) process.exitCode = 1;
    process.stdout.write(`${JSON.stringify({ mode: execute ? 'execute' : 'dry-run', ...before, ...result })}\n`);
  }
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => { void prisma.$disconnect(); });
