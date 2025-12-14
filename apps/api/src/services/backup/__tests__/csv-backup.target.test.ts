import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { CsvBackupTarget } from '../targets/csv-backup.target';
import { BackupService } from '../backup.service';
import { MockStorageProvider } from '../storage/mock-storage.provider';
import { prisma } from '../../../lib/prisma.js';

describe('CsvBackupTarget', () => {
  let storageProvider: MockStorageProvider;
  let backupService: BackupService;

  beforeEach(() => {
    storageProvider = new MockStorageProvider();
    backupService = new BackupService(storageProvider);
  });

  afterEach(async () => {
    // テストデータをクリーンアップ
    await prisma.employee.deleteMany({});
    await prisma.item.deleteMany({});
  });

  it('should backup employees CSV', async () => {
    // テストデータを作成
    await prisma.employee.create({
      data: {
        employeeCode: '0001',
        displayName: 'テスト従業員',
        nfcTagUid: '04C362E1330289',
        department: '製造部',
        contact: '090-1234-5678',
        status: 'ACTIVE'
      }
    });

    const target = new CsvBackupTarget('employees');
    const result = await backupService.backup(target, { label: 'test-employees' });

    expect(result.success).toBe(true);
    expect(result.path).toBeDefined();
    expect(result.sizeBytes).toBeGreaterThan(0);

    // バックアップされたCSVを取得して検証
    const backupData = await storageProvider.download(result.path!);
    const csvContent = backupData.toString('utf-8');
    
    expect(csvContent).toContain('employeeCode');
    expect(csvContent).toContain('displayName');
    expect(csvContent).toContain('0001');
    expect(csvContent).toContain('テスト従業員');
  });

  it('should backup items CSV', async () => {
    // テストデータを作成
    await prisma.item.create({
      data: {
        itemCode: 'TO0001',
        name: 'テスト工具',
        nfcTagUid: '04DE8366BC2A81',
        category: '工具',
        storageLocation: '工具庫A',
        status: 'AVAILABLE',
        notes: 'テスト用'
      }
    });

    const target = new CsvBackupTarget('items');
    const result = await backupService.backup(target, { label: 'test-items' });

    expect(result.success).toBe(true);
    expect(result.path).toBeDefined();
    expect(result.sizeBytes).toBeGreaterThan(0);

    // バックアップされたCSVを取得して検証
    const backupData = await storageProvider.download(result.path!);
    const csvContent = backupData.toString('utf-8');
    
    expect(csvContent).toContain('itemCode');
    expect(csvContent).toContain('name');
    expect(csvContent).toContain('TO0001');
    expect(csvContent).toContain('テスト工具');
  });
});
