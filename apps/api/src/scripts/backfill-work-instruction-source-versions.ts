/**
 * One-time/repair backfill for legacy WorkInstructionRow records.
 *
 * Local:
 *   pnpm --filter @raspi-system/api backfill:work-instruction-source-versions
 * Production API container:
 *   pnpm --filter @raspi-system/api backfill:work-instruction-source-versions:prod
 */

import { prisma } from '../lib/prisma.js';
import { backfillWorkInstructionSourceVersions } from '../services/work-instructions/work-instruction-source-version-backfill.service.js';

const batchSizeArgument = process.argv.find((argument) => argument.startsWith('--batch-size='));
const batchSize = batchSizeArgument ? Number(batchSizeArgument.slice('--batch-size='.length)) : undefined;

try {
  const result = await backfillWorkInstructionSourceVersions(prisma, batchSize === undefined ? {} : { batchSize });
  console.log('[backfill-work-instruction-source-versions] Done:', JSON.stringify(result));
} catch (error) {
  console.error('[backfill-work-instruction-source-versions] Error:', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
