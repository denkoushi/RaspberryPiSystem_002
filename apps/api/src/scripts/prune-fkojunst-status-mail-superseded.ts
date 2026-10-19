/**
 * FKOJUNST_Status mail raw の上書き済み旧行を削除する。既定は dry-run（何も消さない）。
 *
 *   node dist/scripts/prune-fkojunst-status-mail-superseded.js            # dry-run
 *   node dist/scripts/prune-fkojunst-status-mail-superseded.js --execute  # 削除
 */
import { prisma } from '../lib/prisma.js';
import { runFkojunstMailSupersededPrune } from '../services/production-schedule/fkojunst-status-mail-superseded-prune.service.js';

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const result = await runFkojunstMailSupersededPrune({ mode: execute ? 'execute' : 'dry-run' });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
