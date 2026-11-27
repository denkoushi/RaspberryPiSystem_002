import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { prisma } from '../lib/prisma.js';
import {
  readDepartmentMasterXlsx,
  summarizeDepartmentMasterRows
} from '../services/department-master/department-master-import.js';

async function run(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const dryRun = args.includes('--dry-run');
  const pathArg = args.find((arg) => !arg.startsWith('--'));
  if (!pathArg) {
    throw new Error('Usage: pnpm --filter @raspi-system/api import:department-master -- <xlsx-path> [--dry-run]');
  }

  const buffer = await readFile(path.resolve(process.cwd(), pathArg));
  const rows = await readDepartmentMasterXlsx(buffer);
  const summary = summarizeDepartmentMasterRows(rows);

  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, ...summary }, null, 2));
    return;
  }

  const inserted = await prisma.$transaction(async (tx) => {
    await tx.departmentMasterEntry.deleteMany({});
    const created = await tx.departmentMasterEntry.createMany({ data: rows });
    return created.count;
  });
  console.log(JSON.stringify({ dryRun: false, inserted, ...summary }, null, 2));
}

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
