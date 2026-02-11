/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

import { ApiError } from '../../lib/errors.js';
import { CsvImporterFactory } from './csv-importer-factory.js';
import type { CsvImportTarget, ImportSummary } from './csv-importer.types.js';

/**
 * CSVインポート処理（新形式: targets配列ベース）
 */
export async function processCsvImportFromTargets(
  targets: CsvImportTarget[],
  files: Map<string, Buffer>,
  replaceExisting: boolean,
  log: { info: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void }
): Promise<{ summary: Record<string, ImportSummary> }> {
  if (targets.length === 0) {
    throw new ApiError(400, 'インポート対象が指定されていません');
  }

  // すべてのタイプのタグUIDを収集して重複チェック
  const tagUidMap = new Map<string, { type: string; identifier: string }[]>();

  // 各ターゲットをパース
  const parsedData = new Map<string, unknown[]>();
  for (const target of targets) {
    const buffer = files.get(target.type);
    if (!buffer) {
      continue; // ファイルが存在しない場合はスキップ
    }

    const importer = CsvImporterFactory.create(target.type);
    const rows = await importer.parse(buffer);
    parsedData.set(target.type, rows);

    // タグUIDを収集
    for (const row of rows) {
      const tagUid = (row as any).nfcTagUid || (row as any).rfidTagUid;
      if (tagUid && tagUid.trim()) {
        const uid = tagUid.trim();
        if (!tagUidMap.has(uid)) {
          tagUidMap.set(uid, []);
        }
        const identifier = (row as any).employeeCode || (row as any).itemCode || (row as any).managementNumber || '不明';
        tagUidMap.get(uid)!.push({ type: target.type, identifier });
      }
    }
  }

  // タイプ間のタグUID重複チェック
  const crossDuplicateTagUids = Array.from(tagUidMap.entries())
    .filter(([_, entries]) => entries.length > 1 && new Set(entries.map((e) => e.type)).size > 1)
    .map(([uid, entries]) => ({ uid, entries }));

  if (crossDuplicateTagUids.length > 0) {
    const errorMessage = `異なるタイプ間でタグUIDが重複しています: ${crossDuplicateTagUids.map(({ uid, entries }) => `"${uid}" (${entries.map((e) => `${e.type}:${e.identifier}`).join(', ')})`).join('; ')}。異なるタイプ間で同じタグUIDは使用できません。`;
    log.error({ crossDuplicateTagUids }, 'タイプ間でタグUIDが重複');
    throw new ApiError(400, errorMessage);
  }

  const summary: Record<string, ImportSummary> = {};

  try {
    // 各タイプを順次インポート（トランザクションは各インポータ内で処理）
    for (const target of targets) {
      const rows = parsedData.get(target.type);
      if (!rows || rows.length === 0) {
        continue;
      }

      const importer = CsvImporterFactory.create(target.type);
      const result = await importer.import(rows, replaceExisting, log);
      summary[target.type] = result;
    }
  } catch (error) {
    log.error(
      {
        err: error,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorCode: (error as any)?.code,
        errorMeta: (error as any)?.meta,
      },
      'インポート処理エラー'
    );

    if (error instanceof PrismaClientKnownRequestError) {
      if (error.code === 'P2003') {
        const fieldName = (error.meta as any)?.field_name || '不明なフィールド';
        const modelName = (error.meta as any)?.model_name || '不明なモデル';
        throw new ApiError(
          400,
          `外部キー制約違反: ${modelName}の${fieldName}に関連するレコードが存在するため、削除できません。既存の貸出記録や点検記録があるデータは削除できません。`,
          { code: error.code, ...error.meta }
        );
      }
      throw new ApiError(400, `データベースエラー: ${error.code} - ${error.message}`, { code: error.code, ...error.meta });
    }

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(400, `インポート処理エラー: ${error instanceof Error ? error.message : '不明なエラー'}`);
  }

  return { summary };
}

/**
 * CSVインポート処理（旧形式: employees/itemsファイルベース、後方互換性のため残す）
 */
export async function processCsvImport(
  files: { employees?: Buffer; items?: Buffer },
  replaceExisting: boolean,
  log: { info: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void }
) {
  // 旧形式を新形式に変換
  const targets: CsvImportTarget[] = [];
  const fileMap = new Map<string, Buffer>();

  if (files.employees) {
    targets.push({ type: 'employees', source: 'employees.csv' });
    fileMap.set('employees', files.employees);
  }
  if (files.items) {
    targets.push({ type: 'items', source: 'items.csv' });
    fileMap.set('items', files.items);
  }

  if (targets.length === 0) {
    throw new ApiError(400, 'employees.csv もしくは items.csv をアップロードしてください');
  }

  return processCsvImportFromTargets(targets, fileMap, replaceExisting, log);
}
