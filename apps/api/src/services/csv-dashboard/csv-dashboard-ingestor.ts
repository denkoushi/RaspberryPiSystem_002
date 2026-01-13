import { createHash } from 'crypto';
import { parse } from 'csv-parse/sync';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { ApiError } from '../../lib/errors.js';
import type { ColumnDefinition, NormalizedRowData } from './csv-dashboard.types.js';

/**
 * CSVダッシュボード取り込みサービス
 */
export class CsvDashboardIngestor {
  /**
   * Gmailから取得したCSVをダッシュボードに取り込む
   */
  async ingestFromGmail(
    dashboardId: string,
    csvContent: string,
    messageId?: string,
    messageSubject?: string,
    csvFilePath?: string
  ): Promise<{
    rowsProcessed: number;
    rowsAdded: number;
    rowsSkipped: number;
  }> {
    const dashboard = await prisma.csvDashboard.findUnique({
      where: { id: dashboardId },
    });

    if (!dashboard) {
      throw new ApiError(404, 'CSVダッシュボードが見つかりません');
    }

    if (!dashboard.enabled) {
      throw new ApiError(400, 'CSVダッシュボードが無効です');
    }

    // 取り込み実行ログを作成
    const ingestRun = await prisma.csvDashboardIngestRun.create({
      data: {
        csvDashboardId: dashboardId,
        status: 'PROCESSING',
        messageId: messageId ?? null,
        messageSubject: messageSubject ?? null,
        csvFilePath: csvFilePath ?? null,
      },
    });

    try {
      // CSVをパース
      const rows = this.parseCsv(csvContent);
      const columnDefinitions = dashboard.columnDefinitions as unknown as ColumnDefinition[];

      // 列マッピングを作成（CSVヘッダー → 内部名）
      const columnMapping = this.createColumnMapping(rows[0] || [], columnDefinitions);

      // 日付列のインデックスを取得
      const dateColumnIndex = dashboard.dateColumnName
        ? columnMapping.findIndex((m) => m.internalName === dashboard.dateColumnName)
        : -1;

      // 行データを正規化
      const normalizedRows: Array<{ data: NormalizedRowData; occurredAt: Date; hash?: string }> = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const normalized = this.normalizeRow(row, columnMapping);
        const occurredAt = this.extractOccurredAt(row, dateColumnIndex);

        // 重複除去用のハッシュを計算（dedupモードの場合）
        let hash: string | undefined;
        if (dashboard.ingestMode === 'DEDUP') {
          hash = this.calculateDataHash(normalized, dashboard.dedupKeyColumns);
        }

        normalizedRows.push({ data: normalized, occurredAt, hash });
      }

      // 取り込み方式に応じて処理
      let rowsAdded = 0;
      let rowsSkipped = 0;

      if (dashboard.ingestMode === 'APPEND') {
        // 追加モード：すべて追加
        await prisma.csvDashboardRow.createMany({
          data: normalizedRows.map((row) => ({
            csvDashboardId: dashboardId,
            occurredAt: row.occurredAt,
            dataHash: null,
            rowData: row.data as Prisma.InputJsonValue,
          })),
        });
        rowsAdded = normalizedRows.length;
      } else {
        // 重複除去モード：ハッシュで重複チェック
        const existingHashes = new Set<string>();
        if (dashboard.dedupKeyColumns.length > 0) {
          const existingRows = await prisma.csvDashboardRow.findMany({
            where: {
              csvDashboardId: dashboardId,
              dataHash: { not: null },
            },
            select: { dataHash: true },
          });
          existingRows.forEach((row) => {
            if (row.dataHash) existingHashes.add(row.dataHash);
          });
        }

        const rowsToAdd: Array<{
          csvDashboardId: string;
          occurredAt: Date;
          dataHash: string | null;
          rowData: Prisma.InputJsonValue;
        }> = [];

        for (const row of normalizedRows) {
          if (row.hash && existingHashes.has(row.hash)) {
            rowsSkipped++;
          } else {
            if (row.hash) existingHashes.add(row.hash);
            rowsToAdd.push({
              csvDashboardId: dashboardId,
              occurredAt: row.occurredAt,
              dataHash: row.hash ?? null,
              rowData: row.data as Prisma.InputJsonValue,
            });
          }
        }

        if (rowsToAdd.length > 0) {
          await prisma.csvDashboardRow.createMany({
            data: rowsToAdd,
          });
        }
        rowsAdded = rowsToAdd.length;
      }

      // 取り込み実行ログを完了として更新
      await prisma.csvDashboardIngestRun.update({
        where: { id: ingestRun.id },
        data: {
          status: 'COMPLETED',
          rowsProcessed: normalizedRows.length,
          rowsAdded,
          rowsSkipped,
          completedAt: new Date(),
        },
      });

      // CSVファイルパスを更新（最新のCSVファイルパスを記録）
      if (csvFilePath) {
        await prisma.csvDashboard.update({
          where: { id: dashboardId },
          data: { csvFilePath },
        });
      }

      logger.info(
        {
          dashboardId,
          dashboardName: dashboard.name,
          rowsProcessed: normalizedRows.length,
          rowsAdded,
          rowsSkipped,
        },
        '[CsvDashboardIngestor] CSV ingestion completed'
      );

      return {
        rowsProcessed: normalizedRows.length,
        rowsAdded,
        rowsSkipped,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        { err: error, dashboardId, dashboardName: dashboard.name },
        '[CsvDashboardIngestor] CSV ingestion failed'
      );

      // 取り込み実行ログを失敗として更新
      await prisma.csvDashboardIngestRun.update({
        where: { id: ingestRun.id },
        data: {
          status: 'FAILED',
          errorMessage,
          completedAt: new Date(),
        },
      });

      throw error;
    }
  }

  /**
   * CSVをパース
   */
  private parseCsv(csvContent: string): string[][] {
    try {
      const records = parse(csvContent, {
        skip_empty_lines: true,
        relax_column_count: true,
      }) as string[][];
      return records;
    } catch (error) {
      throw new ApiError(400, `CSVのパースに失敗しました: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 列マッピングを作成（CSVヘッダー → 内部名）
   */
  private createColumnMapping(
    csvHeaders: string[],
    columnDefinitions: ColumnDefinition[]
  ): Array<{ csvIndex: number; internalName: string; columnDef: ColumnDefinition }> {
    const mapping: Array<{ csvIndex: number; internalName: string; columnDef: ColumnDefinition }> = [];

    for (const colDef of columnDefinitions) {
      // CSVヘッダーから候補を検索
      const csvIndex = csvHeaders.findIndex((header) =>
        colDef.csvHeaderCandidates.some((candidate) =>
          header.toLowerCase().trim() === candidate.toLowerCase().trim()
        )
      );

      if (csvIndex === -1) {
        // 必須列が見つからない場合はエラー
        if (colDef.required !== false) {
          throw new ApiError(
            400,
            `列 "${colDef.displayName}" (内部名: ${colDef.internalName}) が見つかりません。候補: ${colDef.csvHeaderCandidates.join(', ')}`
          );
        }
        // オプション列の場合はスキップ
        continue;
      }

      mapping.push({
        csvIndex,
        internalName: colDef.internalName,
        columnDef: colDef,
      });
    }

    return mapping;
  }

  /**
   * 行データを正規化（CSV列 → 内部名に変換）
   */
  private normalizeRow(
    row: string[],
    columnMapping: Array<{ csvIndex: number; internalName: string; columnDef: ColumnDefinition }>
  ): NormalizedRowData {
    const normalized: NormalizedRowData = {};

    for (const mapping of columnMapping) {
      const csvValue = row[mapping.csvIndex]?.trim() || '';
      const colDef = mapping.columnDef;

      // データ型に応じて変換
      let value: unknown = csvValue;
      if (csvValue !== '') {
        switch (colDef.dataType) {
          case 'number': {
            const numValue = Number(csvValue);
            value = isNaN(numValue) ? csvValue : numValue; // 変換失敗時は元の値を保持
            break;
          }
          case 'boolean': {
            const lower = csvValue.toLowerCase();
            value = lower === 'true' || lower === '1' || lower === 'yes';
            break;
          }
          case 'date':
            // 日付は後でparseDateで処理するため、ここでは文字列のまま
            value = csvValue;
            break;
          default:
            value = csvValue;
        }
      }

      normalized[mapping.internalName] = value;
    }

    return normalized;
  }

  /**
   * 日付列からoccurredAtを抽出
   * 日付形式: "2026/1/8 8:13" をパースしてAsia/Tokyoタイムゾーンで解釈
   */
  private extractOccurredAt(
    row: string[],
    dateColumnIndex: number
  ): Date {
    if (dateColumnIndex === -1) {
      // 日付列が指定されていない場合は現在時刻を使用
      return new Date();
    }

    const dateValue = row[dateColumnIndex]?.trim();
    if (!dateValue) {
      return new Date();
    }

    try {
      // 日付形式: "2026/1/8 8:13" または "2026/1/8" をパース
      // 正規表現でパース
      const dateTimeMatch = dateValue.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?$/);
      if (!dateTimeMatch) {
        logger.warn({ dateValue }, '[CsvDashboardIngestor] Invalid date format, using current time');
        return new Date();
      }

      const [, year, month, day, hour = '0', minute = '0'] = dateTimeMatch;
      const yearNum = parseInt(year, 10);
      const monthNum = parseInt(month, 10) - 1; // JavaScriptのDateは0始まり
      const dayNum = parseInt(day, 10);
      const hourNum = parseInt(hour, 10);
      const minuteNum = parseInt(minute, 10);

      // Asia/TokyoタイムゾーンでDateオブジェクトを作成
      // UTCに変換する必要があるが、簡易実装としてローカルタイムゾーンで作成
      // 実際の運用では、Asia/Tokyoのオフセット（+09:00）を考慮する必要がある
      const date = new Date(yearNum, monthNum, dayNum, hourNum, minuteNum, 0, 0);
      
      // Asia/Tokyo (UTC+9) を考慮してUTCに変換
      // 日本時間から9時間引いてUTCに変換
      const utcDate = new Date(date.getTime() - 9 * 60 * 60 * 1000);

      if (isNaN(utcDate.getTime())) {
        logger.warn({ dateValue }, '[CsvDashboardIngestor] Invalid date, using current time');
        return new Date();
      }

      return utcDate;
    } catch (error) {
      logger.warn({ err: error, dateValue }, '[CsvDashboardIngestor] Failed to parse date, using current time');
      return new Date();
    }
  }

  /**
   * データハッシュを計算（重複除去用）
   */
  private calculateDataHash(normalized: NormalizedRowData, dedupKeyColumns: string[]): string {
    let hashSource: string;

    if (dedupKeyColumns.length > 0) {
      // 指定されたキー列のみを使用
      const keyValues = dedupKeyColumns
        .map((key) => normalized[key])
        .filter((v) => v !== undefined && v !== null)
        .map((v) => String(v).trim().toLowerCase());
      hashSource = keyValues.join('|');
    } else {
      // 全列を使用
      const allValues = Object.entries(normalized)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, v]) => String(v ?? '').trim().toLowerCase());
      hashSource = allValues.join('|');
    }

    return createHash('sha256').update(hashSource).digest('hex');
  }
}
