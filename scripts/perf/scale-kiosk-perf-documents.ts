/**
 * PERF マーカー付き KioskDocument を指定件数まで増量する（再実行可能）。
 *
 * 実行例:
 *   cd apps/api && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/borrow_return \
 *     PHOTO_STORAGE_DIR=/path/to/tmp/perf-storage \
 *     PDF_STORAGE_DIR=/path/to/tmp/perf-storage \
 *     pnpm exec tsx ../../scripts/perf/scale-kiosk-perf-documents.ts 1500
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prisma } from '../../apps/api/src/lib/prisma.js';

const PERF_PREFIX = 'PERF-';
const DEFAULT_TARGET = 1500;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');

function getPdfsDir(): string {
  return process.env.PDF_STORAGE_DIR?.trim() || path.join(repoRoot, 'tmp/perf-storage/pdfs');
}

function buildDummyJapaneseText(): string {
  const paragraph =
    '組立要領書の性能検証用ダミー本文です。ボルト締付トルク、部品番号、作業順序、安全確認項目を含む長文テキスト。';
  return Array.from({ length: 120 }, (_, index) => `${index + 1}. ${paragraph}`).join('\n');
}

async function main(): Promise<void> {
  const target = Number(process.argv[2] ?? DEFAULT_TARGET);
  if (!Number.isFinite(target) || target < 1) {
    throw new Error('target count must be a positive number');
  }

  const existingCount = await prisma.kioskDocument.count({
    where: { title: { startsWith: `${PERF_PREFIX}KioskDoc-` } },
  });

  if (existingCount >= target) {
    console.log(`[scale-kiosk-docs] skip: ${existingCount} docs already present (target ${target})`);
    return;
  }

  await fs.mkdir(getPdfsDir(), { recursive: true });
  const pdfStub = Buffer.from('%PDF-1.4 perf stub\n');
  const dummyText = buildDummyJapaneseText();

  for (let i = existingCount; i < target; i += 1) {
    const id = randomUUID();
    const seq = String(i + 1).padStart(4, '0');
    const filename = `${PERF_PREFIX.toLowerCase()}kiosk-${seq}.pdf`;
    const filePath = path.join(getPdfsDir(), filename);
    await fs.writeFile(filePath, pdfStub);

    await prisma.kioskDocument.create({
      data: {
        id,
        title: `${PERF_PREFIX}KioskDoc-${seq}`,
        displayTitle: `${PERF_PREFIX}Doc ${seq}`,
        filename,
        filePath,
        sourceType: 'MANUAL',
        enabled: true,
        ocrStatus: 'COMPLETED',
        pageCount: 1,
        extractedText: dummyText,
        confirmedDocumentNumber: `${PERF_PREFIX}DOC-${seq}`,
        confirmedSummaryText: `${PERF_PREFIX}Summary ${seq}`,
      },
    });
  }

  const finalCount = await prisma.kioskDocument.count({
    where: { title: { startsWith: `${PERF_PREFIX}KioskDoc-` } },
  });
  console.log(`[scale-kiosk-docs] scaled ${existingCount} -> ${finalCount} documents`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
