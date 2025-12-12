import fs from 'fs';
import path from 'path';
import { prisma } from '../src/lib/prisma.js';

/**
 * 吊具マスターCSVを取り込み、managementNumberでupsertするスクリプト。
 * 数値列はカンマ区切りを除去してnumberに変換、空欄はnullとして保存。
 *
 * 使い方:
 *   pnpm ts-node apps/api/scripts/import-rigging.ts /path/to/吊具マスター.csv
 */

type CsvRow = {
  ID_num: string;
  name: string;
  storageLocation: string;
  startedAt: string;
  managementNumber: string;
  manageKu: string;
  manageDept: string;
  maxLoadTon: string;
  lengthMm: string;
  widthMm: string;
  thicknessMm: string;
};

const csvSplitRegex = /,(?=(?:[^"]*"[^"]*")*[^"]*$)/;

function parseNumber(value: string): number | null {
  if (!value || value.trim().length === 0) return null;
  const sanitized = value.replace(/,/g, '');
  const num = Number(sanitized);
  return Number.isFinite(num) ? num : null;
}

function parseDate(value: string): Date | null {
  if (!value || value.trim().length === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error('CSVファイルパスを指定してください');
  }
  const absPath = path.resolve(filePath);
  const content = fs.readFileSync(absPath, 'utf8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length <= 1) {
    throw new Error('CSVにデータ行がありません');
  }

  const header = lines[0].split(csvSplitRegex).map((h) => h.trim());
  const requiredHeaders = [
    'ID_num',
    '吊具名称',
    '保管場所',
    '使用開始日',
    '管理番号',
    '管理区',
    '管理部署',
    '最大使用荷重（ｔ）',
    '長さ（mm）',
    '幅（mm）',
    '厚み（mm）'
  ];
  const missing = requiredHeaders.filter((h) => !header.includes(h));
  if (missing.length) {
    throw new Error(`ヘッダ不足: ${missing.join(', ')}`);
  }

  const idx = (name: string) => header.indexOf(name);

  const records: CsvRow[] = lines.slice(1).map((line) => {
    const cols = line.split(csvSplitRegex).map((c) => c.replace(/^"|"$/g, '').trim());
    return {
      ID_num: cols[idx('ID_num')] ?? '',
      name: cols[idx('吊具名称')] ?? '',
      storageLocation: cols[idx('保管場所')] ?? '',
      startedAt: cols[idx('使用開始日')] ?? '',
      managementNumber: cols[idx('管理番号')] ?? '',
      manageKu: cols[idx('管理区')] ?? '',
      manageDept: cols[idx('管理部署')] ?? '',
      maxLoadTon: cols[idx('最大使用荷重（ｔ）')] ?? '',
      lengthMm: cols[idx('長さ（mm）')] ?? '',
      widthMm: cols[idx('幅（mm）')] ?? '',
      thicknessMm: cols[idx('厚み（mm）')] ?? ''
    };
  });

  for (const row of records) {
    if (!row.managementNumber) continue;
    const startedAt = parseDate(row.startedAt);
    const maxLoadTon = parseNumber(row.maxLoadTon);
    const lengthMm = parseNumber(row.lengthMm);
    const widthMm = parseNumber(row.widthMm);
    const thicknessMm = parseNumber(row.thicknessMm);

    await prisma.riggingGear.upsert({
      where: { managementNumber: row.managementNumber },
      create: {
        name: row.name || '吊具',
        managementNumber: row.managementNumber,
        storageLocation: row.storageLocation || null,
        department: row.manageDept || null,
        maxLoadTon,
        lengthMm: lengthMm ? Math.trunc(lengthMm) : null,
        widthMm: widthMm ? Math.trunc(widthMm) : null,
        thicknessMm: thicknessMm ? Math.trunc(thicknessMm) : null,
        startedAt
      },
      update: {
        name: row.name || '吊具',
        storageLocation: row.storageLocation || null,
        department: row.manageDept || null,
        maxLoadTon,
        lengthMm: lengthMm ? Math.trunc(lengthMm) : null,
        widthMm: widthMm ? Math.trunc(widthMm) : null,
        thicknessMm: thicknessMm ? Math.trunc(thicknessMm) : null,
        startedAt
      }
    });
  }

  console.log(`imported/updated ${records.length} rigging gears`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
