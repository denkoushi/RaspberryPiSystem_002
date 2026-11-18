/**
 * 学習あり・なしの書き言葉直しを比較する。DB への書き込みは行わない。
 * モデルが起動している時に使う。
 *
 * 使用方法(ホスト側):
 *   scripts/server/run-in-active-api.sh node /app/apps/api/dist/scripts/evaluate-procedure-dictation.js --site assembly
 *   scripts/server/run-in-active-api.sh node /app/apps/api/dist/scripts/evaluate-procedure-dictation.js --site grinding
 */
import process from 'node:process';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const site = arg('site');
if (site !== 'assembly' && site !== 'grinding') throw new Error('--site assembly|grinding is required');
const { logger } = await import('../lib/logger.js');
logger.level = 'silent'; // Silence inference child loggers before loading the evaluator.
const [{ prisma }, { evaluateProcedureDictation }] = await Promise.all([
  import('../lib/prisma.js'),
  import('../services/assembly/procedure-dictation-evaluation.service.js'),
]);
try {
  const { result } = await evaluateProcedureDictation(site, { manageRuntime: false });
  console.log(JSON.stringify(result));
} finally {
  await prisma.$disconnect();
}
