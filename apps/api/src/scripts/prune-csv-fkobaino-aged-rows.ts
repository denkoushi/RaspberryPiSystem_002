/** Default: --dry-run. Writes only with --execute (at most 20,000 rows total). */
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import {
  CsvDashboardFkobainoAgePruneService,
} from '../services/csv-dashboard/csv-dashboard-fkobaino-age-prune.service.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--dry-run' && arg !== '--execute') ||
      (args.includes('--dry-run') && args.includes('--execute'))) {
    throw new Error('Usage: prune:csv-fkobaino-aged-rows [--dry-run | --execute]');
  }
  const execute = args.includes('--execute');
  if (execute && !env.CSV_FKOBAINO_AGE_PRUNE_ENABLED) {
    throw new Error('--execute requires CSV_FKOBAINO_AGE_PRUNE_ENABLED=true');
  }
  const service = new CsvDashboardFkobainoAgePruneService();
  const before = await service.count();
  const result = execute ? await service.prune() : undefined;
  if (result?.failed) process.exitCode = 1;
  process.stdout.write(`${JSON.stringify({ mode: execute ? 'execute' : 'dry-run', ...before, ...result })}\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => { void prisma.$disconnect(); });
