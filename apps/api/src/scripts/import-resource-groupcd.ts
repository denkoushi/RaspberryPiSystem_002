import { readFile } from 'node:fs/promises';
import path from 'node:path';

import iconv from 'iconv-lite';
import { parse } from 'csv-parse/sync';

import { prisma } from '../lib/prisma.js';

type InputRow = {
  FSIGENCD?: string;
  GroupCD?: string;
};

type ScriptResult = {
  totalRows: number;
  rowsWithGroupCd: number;
  updatedRows: number;
  unmatchedResourceCds: string[];
};

function normalizeResourceCd(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeGroupCd(value: string): string {
  return value.trim().toUpperCase();
}

function decodeCsv(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('\uFFFD')) {
    return utf8;
  }
  return iconv.decode(buffer, 'cp932');
}

async function run(): Promise<void> {
  const csvPathArg = process.argv[2];
  if (!csvPathArg) {
    throw new Error('Usage: pnpm --filter @raspi-system/api import:resource-groupcd -- <csv-path>');
  }

  const csvPath = path.resolve(process.cwd(), csvPathArg);
  const csvBuffer = await readFile(csvPath);
  const csvText = decodeCsv(csvBuffer);

  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true
  }) as InputRow[];

  const resourceToGroupCd = new Map<string, string>();
  for (const row of rows) {
    const resourceCd = normalizeResourceCd(row.FSIGENCD ?? '');
    const groupCd = normalizeGroupCd(row.GroupCD ?? '');
    if (!resourceCd || !groupCd) continue;
    resourceToGroupCd.set(resourceCd, groupCd);
  }

  const resourceCds = Array.from(resourceToGroupCd.keys());
  if (resourceCds.length === 0) {
    const emptyResult: ScriptResult = {
      totalRows: rows.length,
      rowsWithGroupCd: 0,
      updatedRows: 0,
      unmatchedResourceCds: []
    };
    console.log(JSON.stringify(emptyResult, null, 2));
    return;
  }

  const existingRows = await prisma.productionScheduleResourceMaster.findMany({
    where: {
      resourceCd: {
        in: resourceCds
      }
    },
    select: {
      resourceCd: true
    }
  });
  const existingResourceCdSet = new Set(existingRows.map((row) => normalizeResourceCd(row.resourceCd)));

  const updateTargets = resourceCds.filter((resourceCd) => existingResourceCdSet.has(resourceCd));
  let updatedRows = 0;
  for (const resourceCd of updateTargets) {
    const groupCd = resourceToGroupCd.get(resourceCd);
    if (!groupCd) continue;
    const result = await prisma.productionScheduleResourceMaster.updateMany({
      where: {
        resourceCd
      },
      data: {
        groupCd
      }
    });
    updatedRows += result.count;
  }

  const result: ScriptResult = {
    totalRows: rows.length,
    rowsWithGroupCd: resourceToGroupCd.size,
    updatedRows,
    unmatchedResourceCds: resourceCds.filter((resourceCd) => !existingResourceCdSet.has(resourceCd)).sort()
  };

  console.log(JSON.stringify(result, null, 2));
}

run()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
