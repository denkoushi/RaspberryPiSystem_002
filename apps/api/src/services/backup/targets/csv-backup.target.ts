import { stringify } from 'csv-stringify/sync';
import { prisma } from '../../../lib/prisma.js';
import type { BackupTarget } from '../backup-target.interface.js';
import type { BackupTargetInfo, RestoreOptions, RestoreResult } from '../backup-types.js';
import { processCsvImport } from '../../../routes/imports.js';
import { logger } from '../../../lib/logger.js';

/**
 * CSVバックアップターゲット
 * 
 * 従業員データまたはアイテムデータをCSV形式でバックアップします。
 */
export class CsvBackupTarget implements BackupTarget {
  info: BackupTargetInfo;
  private readonly type: 'employees' | 'items';

  constructor(type: 'employees' | 'items', metadata?: Record<string, unknown>) {
    this.type = type;
    this.info = {
      type: 'csv',
      source: type,
      metadata: {
        ...metadata,
        label: metadata?.label as string || `csv-${type}-${new Date().toISOString()}`
      }
    };
  }

  async createBackup(): Promise<Buffer> {
    if (this.type === 'employees') {
      return this.createEmployeesCsv();
    } else {
      return this.createItemsCsv();
    }
  }

  /**
   * 従業員データをCSV形式でエクスポート
   */
  private async createEmployeesCsv(): Promise<Buffer> {
    const batchSize = 1000;
    let offset = 0;
    let isFirstBatch = true;
    const chunks: string[] = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const employees = await prisma.employee.findMany({
        orderBy: { employeeCode: 'asc' },
        skip: offset,
        take: batchSize
      });
      if (employees.length === 0) break;

      const rows = employees.map(emp => ({
        employeeCode: emp.employeeCode,
        displayName: emp.displayName,
        nfcTagUid: emp.nfcTagUid || '',
        department: emp.department || '',
        contact: emp.contact || '',
        status: emp.status
      }));

      const csvChunk = stringify(rows, {
        header: isFirstBatch,
        columns: ['employeeCode', 'displayName', 'nfcTagUid', 'department', 'contact', 'status']
      });
      chunks.push(csvChunk);
      isFirstBatch = false;
      offset += employees.length;
    }

    return Buffer.from(chunks.join(''), 'utf-8');
  }

  /**
   * アイテムデータをCSV形式でエクスポート
   */
  private async createItemsCsv(): Promise<Buffer> {
    const batchSize = 1000;
    let offset = 0;
    let isFirstBatch = true;
    const chunks: string[] = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const items = await prisma.item.findMany({
        orderBy: { itemCode: 'asc' },
        skip: offset,
        take: batchSize
      });
      if (items.length === 0) break;

      const rows = items.map(item => ({
        itemCode: item.itemCode,
        name: item.name,
        nfcTagUid: item.nfcTagUid || '',
        category: item.category || '',
        storageLocation: item.storageLocation || '',
        status: item.status,
        notes: item.notes || ''
      }));

      const csvChunk = stringify(rows, {
        header: isFirstBatch,
        columns: ['itemCode', 'name', 'nfcTagUid', 'category', 'storageLocation', 'status', 'notes']
      });
      chunks.push(csvChunk);
      isFirstBatch = false;
      offset += items.length;
    }

    return Buffer.from(chunks.join(''), 'utf-8');
  }

  async restore(backupData: Buffer, options?: RestoreOptions): Promise<RestoreResult> {
    logger?.info({ type: this.type }, '[CsvBackupTarget] Restoring CSV from backup');

    try {
      // CSVデータをパースしてインポート処理を実行
      const csvType = this.type;
      const files = csvType === 'employees' ? { employees: backupData } : { items: backupData };

      const logWrapper = {
        info: (obj: unknown, msg: string) => {
          logger?.info(obj, msg);
        },
        error: (obj: unknown, msg: string) => {
          logger?.error(obj, msg);
        }
      };

      await processCsvImport(files, options?.overwrite ?? true, logWrapper);

      logger?.info({ type: this.type }, '[CsvBackupTarget] CSV restore completed');

      return {
        backupId: this.type,
        success: true,
        timestamp: new Date()
      };
    } catch (error) {
      logger?.error({ err: error, type: this.type }, '[CsvBackupTarget] CSV restore failed');
      throw error;
    }
  }
}
