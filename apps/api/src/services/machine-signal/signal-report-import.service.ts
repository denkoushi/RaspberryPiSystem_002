import { createHash } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import {
  parseSignalDailyReport,
  parseSignalFileName,
  SignalDailyReportParseError,
} from './signal-daily-report.parser.js';

export type SignalReportSource = 'GMAIL' | 'UPLOAD';

export type SignalReportFile = { fileName: string; content: Buffer };

export type SignalReportImportFailure = { fileName: string; reason: string };

export type SignalReportImportSummary = {
  runId: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  fileCount: number;
  importedCount: number;
  failedCount: number;
  failures: SignalReportImportFailure[];
  /** 取り込んだ集計日（YYYY-MM-DD）の一覧 */
  reportDates: string[];
};

const MAX_RECORDED_FAILURES = 50;

/** パス付きで届いたファイル名（フォルダ選択のアップロード）から末尾の名前だけを取る。 */
const baseName = (fileName: string) => fileName.split(/[\\/]/).pop() ?? fileName;

/**
 * 日報CSV 1件を保存する。同じセンサー・同じ集計日は上書きするので、何度取り込んでも結果は同じ。
 * センサーが未登録なら、日報の機械名で登録する（設定は管理画面で後から付ける）。
 */
export async function importSignalReportFile(file: SignalReportFile, source: SignalReportSource): Promise<string> {
  const name = baseName(file.fileName);
  const fromName = parseSignalFileName(name);
  if (!fromName) {
    throw new SignalDailyReportParseError('ファイル名が DailySummary_Signal<番号>_<日付>.csv の形式ではありません');
  }
  const report = parseSignalDailyReport(file.content);
  const reportDate = new Date(`${report.reportDate}T00:00:00.000Z`);
  const data = {
    machineName: report.machineName,
    dayStartMinute: report.dayStartMinute,
    summary: report.summary as Prisma.InputJsonValue,
    stateNames: report.stateNames as Prisma.InputJsonValue,
    segments: report.segments as unknown as Prisma.InputJsonValue,
    contentHash: createHash('sha256').update(file.content).digest('hex'),
    source,
    sourceFileName: name.slice(0, 255),
  };

  await prisma.$transaction([
    prisma.machineSignalSensor.upsert({
      where: { signalNo: fromName.signalNo },
      create: { signalNo: fromName.signalNo, sourceMachineName: report.machineName },
      update: { sourceMachineName: report.machineName },
    }),
    prisma.machineSignalDailyReport.upsert({
      where: { signalNo_reportDate: { signalNo: fromName.signalNo, reportDate } },
      create: { signalNo: fromName.signalNo, reportDate, ...data },
      update: data,
    }),
  ]);
  return report.reportDate;
}

/** 複数の日報CSVを順に取り込み、結果を1回の取り込み記録として残す。読めないファイルは飛ばして続ける。 */
export async function importSignalReportFiles(
  files: SignalReportFile[],
  options: { source: SignalReportSource; gmailMessageId?: string }
): Promise<SignalReportImportSummary> {
  const failures: SignalReportImportFailure[] = [];
  const reportDates = new Set<string>();
  let importedCount = 0;

  for (const file of files) {
    try {
      reportDates.add(await importSignalReportFile(file, options.source));
      importedCount += 1;
    } catch (error) {
      if (!(error instanceof SignalDailyReportParseError)) throw error;
      failures.push({ fileName: baseName(file.fileName), reason: error.message });
    }
  }

  const status = failures.length === 0 && importedCount > 0 ? 'SUCCESS' : importedCount > 0 ? 'PARTIAL' : 'FAILED';
  const run = await prisma.machineSignalImportRun.create({
    data: {
      source: options.source,
      gmailMessageId: options.gmailMessageId ?? null,
      status,
      fileCount: files.length,
      importedCount,
      failedCount: failures.length,
      errors: failures.slice(0, MAX_RECORDED_FAILURES) as unknown as Prisma.InputJsonValue,
    },
  });

  return {
    runId: run.id,
    status,
    fileCount: files.length,
    importedCount,
    failedCount: failures.length,
    failures,
    reportDates: [...reportDates].sort(),
  };
}

export type SignalImportRunDto = {
  id: string;
  source: string;
  status: string;
  fileCount: number;
  importedCount: number;
  failedCount: number;
  failures: SignalReportImportFailure[];
  startedAt: string;
};

export async function listSignalImportRuns(limit = 20): Promise<SignalImportRunDto[]> {
  const rows = await prisma.machineSignalImportRun.findMany({ orderBy: { startedAt: 'desc' }, take: limit });
  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    status: row.status,
    fileCount: row.fileCount,
    importedCount: row.importedCount,
    failedCount: row.failedCount,
    failures: Array.isArray(row.errors) ? (row.errors as unknown as SignalReportImportFailure[]) : [],
    startedAt: row.startedAt.toISOString(),
  }));
}
