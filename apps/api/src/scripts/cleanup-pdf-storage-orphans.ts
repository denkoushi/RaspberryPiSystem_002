#!/usr/bin/env node
/**
 * pdf-pages / pdfs 配下の孤児（DB に参照がないディレクトリ・ファイル）を検出・削除する。
 *
 * 使用方法:
 *   pnpm --filter @raspi-system/api exec tsx src/scripts/cleanup-pdf-storage-orphans.ts --dry-run
 *   pnpm --filter @raspi-system/api exec tsx src/scripts/cleanup-pdf-storage-orphans.ts --execute
 *
 * --execute を付けない場合は dry-run（既定）。
 */

import { promises as fs } from 'fs';
import path from 'path';

import { PrismaClient } from '@prisma/client';

import { PDF_PAGES_DIR } from '../lib/pdf-storage.js';

const getStorageBaseDir = () =>
  process.env.PDF_STORAGE_DIR ||
  (process.env.NODE_ENV === 'test' ? '/tmp/test-photo-storage' : '/opt/RaspberryPiSystem_002/storage');
const getPdfsDir = () => path.join(getStorageBaseDir(), 'pdfs');

const UUID_DIR =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseArgs(argv: string[]): { execute: boolean } {
  const execute = argv.includes('--execute');
  return { execute };
}

async function main() {
  const { execute } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  const pdfsDir = getPdfsDir();
  const pagesDir = PDF_PAGES_DIR;

  try {
    const [kioskDocs, signagePdfs] = await Promise.all([
      prisma.kioskDocument.findMany({ select: { id: true, filePath: true } }),
      prisma.signagePdf.findMany({ select: { id: true, filePath: true } }),
    ]);

    const referencedPageIds = new Set<string>([
      ...kioskDocs.map((d) => d.id),
      ...signagePdfs.map((p) => p.id),
    ]);

    const referencedPdfBasenames = new Set<string>();
    for (const row of [...kioskDocs, ...signagePdfs]) {
      referencedPdfBasenames.add(path.basename(row.filePath));
    }

    let wouldRemoveDirs = 0;
    let wouldRemoveFiles = 0;

    try {
      const pageEntries = await fs.readdir(pagesDir, { withFileTypes: true });
      for (const ent of pageEntries) {
        if (!ent.isDirectory()) continue;
        const name = ent.name;
        if (!UUID_DIR.test(name)) continue;
        if (referencedPageIds.has(name)) continue;
        const full = path.join(pagesDir, name);
        console.log(`[orphan-dir] ${full}`);
        wouldRemoveDirs += 1;
        if (execute) {
          await fs.rm(full, { recursive: true, force: true });
        }
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }

    try {
      const pdfFiles = await fs.readdir(pdfsDir, { withFileTypes: true });
      for (const ent of pdfFiles) {
        if (!ent.isFile()) continue;
        const name = ent.name;
        if (!name.toLowerCase().endsWith('.pdf')) continue;
        if (referencedPdfBasenames.has(name)) continue;
        const full = path.join(pdfsDir, name);
        console.log(`[orphan-pdf] ${full}`);
        wouldRemoveFiles += 1;
        if (execute) {
          await fs.unlink(full);
        }
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }

    console.log(
      execute
        ? `[done] removed ${wouldRemoveDirs} dirs, ${wouldRemoveFiles} pdf files`
        : `[dry-run] would remove ${wouldRemoveDirs} dirs, ${wouldRemoveFiles} pdf files (pass --execute to delete)`
    );
    process.exit(0);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('[ERROR]', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
