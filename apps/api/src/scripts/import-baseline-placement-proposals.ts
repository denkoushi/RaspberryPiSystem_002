/**
 * 事前に計算した検査図面の丸数字案(baseline-v1)を取り込む。既定は dry-run で、--apply のときだけ書き込む。
 *
 * 使い方:
 *   pnpm --filter @raspi-system/api import:baseline-placement-proposals -- proposals.json
 *   pnpm --filter @raspi-system/api import:baseline-placement-proposals -- proposals.json --apply
 *   cat proposals.json | pnpm --filter @raspi-system/api import:baseline-placement-proposals -- --apply
 *
 * Docker:
 *   docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api pnpm import:baseline-placement-proposals:prod -- --apply < proposals.json
 */

import { readFile } from 'node:fs/promises';

import { prisma } from '../lib/prisma.js';
import {
  baselinePlacementImportSchema,
  importBaselinePlacementProposals
} from '../services/part-measurement/part-measurement-drawing-baseline-placement-import.js';

const TAG = '[import-baseline-placement-proposals]';

function parseArgs(argv: string[]): { apply: boolean; filePath?: string } {
  const args: { apply: boolean; filePath?: string } = { apply: false };
  for (const raw of argv) {
    if (raw === '--apply') args.apply = true;
    else if (!raw.startsWith('--') && args.filePath === undefined) args.filePath = raw;
  }
  return args;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const text = args.filePath ? await readFile(args.filePath, 'utf8') : await readStdin();
  const input = baselinePlacementImportSchema.parse(JSON.parse(text));
  const summary = await importBaselinePlacementProposals(input, { apply: args.apply });
  console.log(`${TAG} apply=${summary.apply} drawings=${input.drawings.length}`);
  for (const drawing of summary.drawings) {
    console.log(`${TAG} visualTemplateId=${drawing.visualTemplateId} proposals=${drawing.proposals} result=${drawing.result}${drawing.reason ? ` reason=${drawing.reason}` : ''}`);
  }
  console.log(`${TAG} summary created=${summary.created} replaced=${summary.replaced} skipped=${summary.skipped} failed=${summary.failed}${summary.apply ? '' : ' (dry-run: nothing written)'}`);
  return summary.failed > 0 ? 1 : 0;
}

void main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`${TAG} error`, error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {
      /* ignore */
    });
  });
