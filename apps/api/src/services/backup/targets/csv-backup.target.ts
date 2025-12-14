import { stringify } from 'csv-stringify/sync';
import { prisma } from '../../../lib/prisma.js';
import type { BackupTarget } from '../backup-target.interface';
import type { BackupTargetInfo } from '../backup-types.js';

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
    const employees = await prisma.employee.findMany({
      orderBy: { employeeCode: 'asc' }
    });

    const rows = employees.map(emp => ({
      employeeCode: emp.employeeCode,
      displayName: emp.displayName,
      nfcTagUid: emp.nfcTagUid || '',
      department: emp.department || '',
      contact: emp.contact || '',
      status: emp.status
    }));

    const csv = stringify(rows, {
      header: true,
      columns: ['employeeCode', 'displayName', 'nfcTagUid', 'department', 'contact', 'status']
    });

    return Buffer.from(csv, 'utf-8');
  }

  /**
   * アイテムデータをCSV形式でエクスポート
   */
  private async createItemsCsv(): Promise<Buffer> {
    const items = await prisma.item.findMany({
      orderBy: { itemCode: 'asc' }
    });

    const rows = items.map(item => ({
      itemCode: item.itemCode,
      name: item.name,
      nfcTagUid: item.nfcTagUid || '',
      category: item.category || '',
      storageLocation: item.storageLocation || '',
      status: item.status,
      notes: item.notes || ''
    }));

    const csv = stringify(rows, {
      header: true,
      columns: ['itemCode', 'name', 'nfcTagUid', 'category', 'storageLocation', 'status', 'notes']
    });

    return Buffer.from(csv, 'utf-8');
  }
}
