/** Dry run by default. Pass --dry-run=false --limit=100 to process eligible photos. */
import { prisma } from '../lib/prisma.js';
import { getProcedureMaterialImageDescriptionService } from '../services/assembly/procedure-material-image-description.service.js';

async function main() {
  const argv = process.argv.slice(2).filter(arg => arg !== '--');
  let dryRun = true;
  let limit = 100;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run' || arg === '--dry-run=true') dryRun = true;
    else if (arg === '--dry-run=false') dryRun = false;
    else if (arg === '--limit' || arg.startsWith('--limit=')) {
      limit = Number(arg === '--limit' ? argv[++i] : arg.slice('--limit='.length));
      if (!Number.isInteger(limit) || limit < 1 || limit > 20_000) throw new Error('--limit must be an integer between 1 and 20000');
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  const service = getProcedureMaterialImageDescriptionService();
  if (dryRun) {
    const targets = await service.inspectTargets(limit);
    console.log(JSON.stringify({ dryRun, limit, targets: targets.length, ids: targets.map(row => row.id) }));
    return;
  }
  const totals = { processed: 0, failed: 0 };
  while (totals.processed + totals.failed < limit) {
    const result = await service.runBatch({ batchSize: Math.min(3, limit - totals.processed - totals.failed) });
    totals.processed += result.processed; totals.failed += result.failed;
    if (!result.processed && !result.failed) break;
  }
  console.log(JSON.stringify({ dryRun, limit, ...totals }));
  if (totals.failed) process.exitCode = 2;
}

void main().catch(() => {
  console.error('Procedure material image description backfill failed'); process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
