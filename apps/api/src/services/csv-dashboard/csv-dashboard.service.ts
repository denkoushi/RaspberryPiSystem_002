import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import type {
  CsvDashboardCreateInput,
  CsvDashboardUpdateInput,
  CsvDashboardQuery,
  CsvPreviewResult,
  ColumnDefinition,
  NormalizedRowData,
  DashboardPageData,
} from './csv-dashboard.types.js';
import type { Prisma, CsvDashboard } from '@prisma/client';

export class CsvDashboardService {
  /**
   * CSVダッシュボード一覧を取得
   */
  async findAll(query: CsvDashboardQuery = {}): Promise<CsvDashboard[]> {
    const where: Prisma.CsvDashboardWhereInput = {
      ...(query.enabled !== undefined ? { enabled: query.enabled } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    return await prisma.csvDashboard.findMany({
      where,
      orderBy: { name: 'asc' },
    });
  }

  /**
   * IDでCSVダッシュボードを取得
   */
  async findById(id: string): Promise<CsvDashboard> {
    const dashboard = await prisma.csvDashboard.findUnique({
      where: { id },
    });
    if (!dashboard) {
      throw new ApiError(404, 'CSVダッシュボードが見つかりません');
    }
    return dashboard;
  }

  /**
   * CSVダッシュボードを作成
   */
  async create(input: CsvDashboardCreateInput): Promise<CsvDashboard> {
    // バリデーション
    this.validateColumnDefinitions(input.columnDefinitions);
    this.validateTemplateConfig(input.templateType || 'TABLE', input.templateConfig);

    return await prisma.csvDashboard.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        columnDefinitions: input.columnDefinitions as unknown as Prisma.JsonArray,
        dateColumnName: input.dateColumnName ?? null,
        displayPeriodDays: input.displayPeriodDays ?? 1,
        emptyMessage: input.emptyMessage ?? null,
        ingestMode: input.ingestMode || 'APPEND',
        dedupKeyColumns: input.dedupKeyColumns || [],
        gmailScheduleId: input.gmailScheduleId ?? null,
        templateType: input.templateType || 'TABLE',
        templateConfig: input.templateConfig as unknown as Prisma.JsonObject,
      },
    });
  }

  /**
   * CSVダッシュボードを更新
   */
  async update(id: string, input: CsvDashboardUpdateInput): Promise<CsvDashboard> {
    // 存在確認
    await this.findById(id);

    // バリデーション
    if (input.columnDefinitions) {
      this.validateColumnDefinitions(input.columnDefinitions);
    }
    if (input.templateConfig && input.templateType) {
      this.validateTemplateConfig(input.templateType, input.templateConfig);
    }

    const updateData: Prisma.CsvDashboardUpdateInput = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.columnDefinitions !== undefined)
      updateData.columnDefinitions = input.columnDefinitions as unknown as Prisma.JsonArray;
    if (input.dateColumnName !== undefined) updateData.dateColumnName = input.dateColumnName;
    if (input.displayPeriodDays !== undefined) updateData.displayPeriodDays = input.displayPeriodDays;
    if (input.emptyMessage !== undefined) updateData.emptyMessage = input.emptyMessage;
    if (input.ingestMode !== undefined) updateData.ingestMode = input.ingestMode;
    if (input.dedupKeyColumns !== undefined) updateData.dedupKeyColumns = input.dedupKeyColumns;
    if (input.gmailScheduleId !== undefined) updateData.gmailScheduleId = input.gmailScheduleId;
    if (input.templateType !== undefined) updateData.templateType = input.templateType;
    if (input.templateConfig !== undefined) updateData.templateConfig = input.templateConfig as unknown as Prisma.JsonObject;
    if (input.enabled !== undefined) updateData.enabled = input.enabled;

    return await prisma.csvDashboard.update({
      where: { id },
      data: updateData,
    });
  }

  /**
   * CSVダッシュボードを削除
   */
  async delete(id: string): Promise<CsvDashboard> {
    // 存在確認
    await this.findById(id);

    return await prisma.csvDashboard.delete({
      where: { id },
    });
  }

  /**
   * CSVファイルをプレビュー解析
   */
  async previewCsv(csvContent: string): Promise<CsvPreviewResult> {
    const lines = csvContent.split('\n').filter((line) => line.trim());
    if (lines.length === 0) {
      throw new ApiError(400, 'CSVファイルが空です');
    }

    // ヘッダー行を取得
    const headers = this.parseCsvLine(lines[0]);

    // サンプル行を取得（最大10行）
    const sampleRows: Record<string, unknown>[] = [];
    const maxSampleRows = Math.min(10, lines.length - 1);
    for (let i = 1; i <= maxSampleRows; i++) {
      const values = this.parseCsvLine(lines[i]);
      const row: Record<string, unknown> = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      sampleRows.push(row);
    }

    // 型を検出
    const detectedTypes: Record<string, 'string' | 'number' | 'date' | 'boolean'> = {};
    headers.forEach((header) => {
      detectedTypes[header] = this.detectType(sampleRows, header);
    });

    return {
      headers,
      sampleRows,
      detectedTypes,
    };
  }

  /**
   * 列定義のバリデーション
   */
  private validateColumnDefinitions(columnDefinitions: ColumnDefinition[]): void {
    if (columnDefinitions.length === 0) {
      throw new ApiError(400, '列定義が空です');
    }

    const internalNames = new Set<string>();
    const orders = new Set<number>();

    for (const col of columnDefinitions) {
      if (!col.internalName || !col.displayName) {
        throw new ApiError(400, '列定義に内部名または表示名がありません');
      }
      if (internalNames.has(col.internalName)) {
        throw new ApiError(400, `内部名 "${col.internalName}" が重複しています`);
      }
      if (orders.has(col.order)) {
        throw new ApiError(400, `順序 "${col.order}" が重複しています`);
      }
      internalNames.add(col.internalName);
      orders.add(col.order);
    }
  }

  /**
   * テンプレート設定のバリデーション
   */
  private validateTemplateConfig(
    templateType: 'TABLE' | 'CARD_GRID',
    templateConfig: unknown
  ): void {
    if (templateType === 'TABLE') {
      const config = templateConfig as { rowsPerPage?: number; fontSize?: number; displayColumns?: string[] };
      if (!config.rowsPerPage || config.rowsPerPage <= 0) {
        throw new ApiError(400, 'テーブル形式の行数が無効です');
      }
      if (!config.fontSize || config.fontSize <= 0) {
        throw new ApiError(400, 'フォントサイズが無効です');
      }
      if (!config.displayColumns || config.displayColumns.length === 0) {
        throw new ApiError(400, '表示列が指定されていません');
      }
    } else if (templateType === 'CARD_GRID') {
      const config = templateConfig as {
        cardsPerPage?: number;
        fontSize?: number;
        displayFields?: string[];
      };
      if (!config.cardsPerPage || config.cardsPerPage <= 0) {
        throw new ApiError(400, 'カードグリッド形式のカード数が無効です');
      }
      if (!config.fontSize || config.fontSize <= 0) {
        throw new ApiError(400, 'フォントサイズが無効です');
      }
      if (!config.displayFields || config.displayFields.length === 0) {
        throw new ApiError(400, '表示項目が指定されていません');
      }
    }
  }

  /**
   * CSV行をパース（簡易実装、カンマ区切り）
   */
  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++; // 次のダブルクォートをスキップ
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());

    return result;
  }

  /**
   * 表示用のページデータを取得
   */
  async getPageData(
    dashboardId: string,
    pageNumber: number,
    displayPeriodDays: number = 1
  ): Promise<DashboardPageData> {
    const dashboard = await this.findById(dashboardId);
    const templateConfig = dashboard.templateConfig as { rowsPerPage?: number; cardsPerPage?: number };

    // 表示期間の開始日時を計算（Asia/Tokyo = UTC+9）
    // サーバーはUTC環境で動作しているため、JSTの「今日」を計算するにはUTC+9を考慮
    const nowUtc = new Date();
    const jstOffset = 9 * 60 * 60 * 1000; // JST = UTC + 9時間
    
    // JSTでの「今日の0:00」をUTCで表現 → UTC 前日15:00
    const nowJst = new Date(nowUtc.getTime() + jstOffset);
    const startOfTodayJst = new Date(nowJst);
    startOfTodayJst.setHours(0, 0, 0, 0);
    const startDateUtc = new Date(startOfTodayJst.getTime() - jstOffset - (displayPeriodDays - 1) * 24 * 60 * 60 * 1000);
    
    // JSTでの「今日の23:59:59」をUTCで表現 → UTC 翌日14:59:59
    const endOfTodayJst = new Date(nowJst);
    endOfTodayJst.setHours(23, 59, 59, 999);
    const endDateUtc = new Date(endOfTodayJst.getTime() - jstOffset);

    // 期間内の行データを取得
    const rows = await prisma.csvDashboardRow.findMany({
      where: {
        csvDashboardId: dashboardId,
        occurredAt: {
          gte: startDateUtc,
          lte: endDateUtc,
        },
      },
      orderBy: { occurredAt: 'desc' },
    });

    // ページネーション
    const rowsPerPage =
      dashboard.templateType === 'TABLE'
        ? (templateConfig as { rowsPerPage?: number }).rowsPerPage || 10
        : (templateConfig as { cardsPerPage?: number }).cardsPerPage || 9;
    const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage));
    const startIndex = (pageNumber - 1) * rowsPerPage;
    const endIndex = startIndex + rowsPerPage;
    const pageRows = rows.slice(startIndex, endIndex);

    // 正規化された行データに変換
    const normalizedRows: NormalizedRowData[] = pageRows.map((row) => row.rowData as NormalizedRowData);

    return {
      pageNumber,
      totalPages,
      rows: normalizedRows,
    };
  }

  /**
   * 型を検出
   */
  private detectType(
    sampleRows: Record<string, unknown>[],
    header: string
  ): 'string' | 'number' | 'date' | 'boolean' {
    if (sampleRows.length === 0) return 'string';

    const values = sampleRows.map((row) => row[header]).filter((v) => v !== undefined && v !== null && v !== '');

    if (values.length === 0) return 'string';

    // 数値チェック
    let allNumbers = true;
    for (const value of values) {
      if (typeof value === 'number') continue;
      if (typeof value === 'string' && !isNaN(Number(value))) continue;
      allNumbers = false;
      break;
    }
    if (allNumbers) return 'number';

    // 日付チェック（簡易実装）
    let allDates = true;
    for (const value of values) {
      const str = String(value);
      // YYYY/MM/DD または YYYY/MM/DD HH:mm 形式をチェック
      if (!/^\d{4}\/\d{1,2}\/\d{1,2}(\s+\d{1,2}:\d{1,2})?$/.test(str)) {
        allDates = false;
        break;
      }
    }
    if (allDates) return 'date';

    // 真偽値チェック
    let allBooleans = true;
    for (const value of values) {
      const str = String(value).toLowerCase();
      if (str !== 'true' && str !== 'false' && str !== '1' && str !== '0' && str !== 'yes' && str !== 'no') {
        allBooleans = false;
        break;
      }
    }
    if (allBooleans) return 'boolean';

    return 'string';
  }

  /**
   * 古いCSVダッシュボードデータを削除（レテンション管理）
   * 前年(2025)は保持、前々年(2024)は削除、当年の前月分を月次で削除
   */
  async cleanupOldData(): Promise<{ deletedRows: number; deletedIngestRuns: number }> {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const twoYearsAgo = currentYear - 2; // 前々年

    let deletedRows = 0;
    let deletedIngestRuns = 0;

    try {
      // 前々年のデータを削除
      const twoYearsAgoStart = new Date(twoYearsAgo, 0, 1, 0, 0, 0, 0);
      const twoYearsAgoEnd = new Date(twoYearsAgo, 11, 31, 23, 59, 59, 999);
      
      // UTCに変換（Asia/Tokyo = UTC+9）
      const twoYearsAgoStartUtc = new Date(twoYearsAgoStart.getTime() - 9 * 60 * 60 * 1000);
      const twoYearsAgoEndUtc = new Date(twoYearsAgoEnd.getTime() - 9 * 60 * 60 * 1000);

      const deletedRowsTwoYearsAgo = await prisma.csvDashboardRow.deleteMany({
        where: {
          occurredAt: {
            gte: twoYearsAgoStartUtc,
            lte: twoYearsAgoEndUtc,
          },
        },
      });
      deletedRows += deletedRowsTwoYearsAgo.count;

      const deletedIngestRunsTwoYearsAgo = await prisma.csvDashboardIngestRun.deleteMany({
        where: {
          startedAt: {
            gte: twoYearsAgoStartUtc,
            lte: twoYearsAgoEndUtc,
          },
        },
      });
      deletedIngestRuns += deletedIngestRunsTwoYearsAgo.count;

      // 当年の過去月（当月より前）を削除
      if (currentMonth > 1) {
        // 例: 2月(=currentMonth=2) になったら 1月データを削除、3月なら 1月/2月を削除
        const startOfCurrentYearJst = new Date(currentYear, 0, 1, 0, 0, 0, 0);
        const startOfCurrentMonthJst = new Date(currentYear, currentMonth - 1, 1, 0, 0, 0, 0);

        // UTCに変換（Asia/Tokyo = UTC+9）
        const startOfCurrentYearUtc = new Date(startOfCurrentYearJst.getTime() - 9 * 60 * 60 * 1000);
        const startOfCurrentMonthUtc = new Date(startOfCurrentMonthJst.getTime() - 9 * 60 * 60 * 1000);

        const deletedRowsCurrentYearPastMonths = await prisma.csvDashboardRow.deleteMany({
          where: {
            occurredAt: {
              gte: startOfCurrentYearUtc,
              lt: startOfCurrentMonthUtc,
            },
          },
        });
        deletedRows += deletedRowsCurrentYearPastMonths.count;

        const deletedIngestRunsCurrentYearPastMonths = await prisma.csvDashboardIngestRun.deleteMany({
          where: {
            startedAt: {
              gte: startOfCurrentYearUtc,
              lt: startOfCurrentMonthUtc,
            },
          },
        });
        deletedIngestRuns += deletedIngestRunsCurrentYearPastMonths.count;
      }

      logger?.info(
        { deletedRows, deletedIngestRuns, currentYear, currentMonth },
        '[CsvDashboardService] Cleanup completed'
      );

      return { deletedRows, deletedIngestRuns };
    } catch (error) {
      logger?.error({ err: error }, '[CsvDashboardService] Cleanup failed');
      throw error;
    }
  }
}
