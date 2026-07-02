/**
 * 既存 PartMeasurementVisualTemplate の図面 OCR キャッシュを作成・処理する。
 *
 * 使い方:
 *   pnpm --filter @raspi-system/api backfill:part-measurement-drawing-ocr -- --dry-run
 *   pnpm --filter @raspi-system/api backfill:part-measurement-drawing-ocr -- --limit=100
 *
 * Docker:
 *   docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api pnpm backfill:part-measurement-drawing-ocr:prod -- --limit=100
 */

import { prisma } from '../lib/prisma.js';
import { shutdownImageOcrPort } from '../services/ocr/image-ocr-runtime.js';
import {
  getPartMeasurementDrawingOcrService,
  PART_MEASUREMENT_DRAWING_OCR_QUEUE_PRIORITY
} from '../services/part-measurement/part-measurement-drawing-ocr.service.js';

type Args = {
  dryRun: boolean;
  includeInactive: boolean;
  limit?: number;
  visualTemplateId?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, includeInactive: false };
  for (const raw of argv) {
    if (raw === '--dry-run') {
      args.dryRun = true;
    } else if (raw === '--include-inactive') {
      args.includeInactive = true;
    } else if (raw.startsWith('--limit=')) {
      const n = Number.parseInt(raw.slice('--limit='.length), 10);
      if (Number.isFinite(n) && n > 0) args.limit = n;
    } else if (raw === '--limit') {
      const next = argv[argv.indexOf(raw) + 1];
      const n = next ? Number.parseInt(next, 10) : NaN;
      if (Number.isFinite(n) && n > 0) args.limit = n;
    } else if (raw.startsWith('--visual-template-id=')) {
      args.visualTemplateId = raw.slice('--visual-template-id='.length).trim();
    } else if (raw === '--visual-template-id') {
      const next = argv[argv.indexOf(raw) + 1];
      if (next) args.visualTemplateId = next.trim();
    }
  }
  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const service = getPartMeasurementDrawingOcrService();
  if (args.dryRun) {
    const inspection = await service.inspectBackfillTargets({
      includeInactive: args.includeInactive,
      visualTemplateId: args.visualTemplateId,
      limit: args.limit
    });
    console.log(
      `[backfill-part-measurement-drawing-ocr] dryRun=true includeInactive=${args.includeInactive} targets=${inspection.summary.totalTargets} referenced=${inspection.summary.referencedByActiveTemplate} missing=${inspection.summary.missing} pending=${inspection.summary.pending} processing=${inspection.summary.processing} completed=${inspection.summary.completed} failed=${inspection.summary.failed} unreadable=${inspection.summary.unreadable}`
    );
    for (const target of inspection.targets.slice(0, 20)) {
      console.log(
        `[backfill-part-measurement-drawing-ocr] target visualTemplateId=${target.visualTemplateId} referenced=${target.isReferencedByActiveTemplate} status=${target.cacheStatus} priority=${target.priority}`
      );
    }
    if (inspection.targets.length > 20) {
      console.log(`[backfill-part-measurement-drawing-ocr] ... ${inspection.targets.length - 20} more targets`);
    }
    return 0;
  }

  const targets = await service.listVisualTemplateBackfillTargets({
    includeInactive: args.includeInactive,
    visualTemplateId: args.visualTemplateId,
    limit: args.limit
  });
  console.log(
    `[backfill-part-measurement-drawing-ocr] targets=${targets.length} dryRun=${args.dryRun} includeInactive=${args.includeInactive}`
  );

  let enqueued = 0;
  let enqueueFailed = 0;
  for (const target of targets) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await service.enqueueVisualTemplate(target.visualTemplateId, {
        includeInactive: args.includeInactive,
        priority: target.priority || PART_MEASUREMENT_DRAWING_OCR_QUEUE_PRIORITY.BACKFILL_ACTIVE
      });
      enqueued += 1;
    } catch (error) {
      enqueueFailed += 1;
      console.warn('[backfill-part-measurement-drawing-ocr] enqueue failed', target.visualTemplateId, error);
    }
  }

  let processed = 0;
  let failed = 0;
  while (processed + failed < enqueued) {
    // eslint-disable-next-line no-await-in-loop
    const result = await service.runBatch({ batchSize: 1 });
    if (result.processed === 0 && result.failed === 0) break;
    processed += result.processed;
    failed += result.failed;
    console.log(`[backfill-part-measurement-drawing-ocr] processed=${processed} failed=${failed}`);
  }

  console.log(
    `[backfill-part-measurement-drawing-ocr] done enqueued=${enqueued} enqueueFailed=${enqueueFailed} processed=${processed} failed=${failed}`
  );
  return enqueueFailed > 0 || failed > 0 ? 2 : 0;
}

void main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error('[backfill-part-measurement-drawing-ocr] error', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await shutdownImageOcrPort().catch((error: unknown) => {
      console.warn('[backfill-part-measurement-drawing-ocr] OCR shutdown failed', error);
    });
    await prisma.$disconnect().catch(() => {
      /* ignore */
    });
  });
