import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { CsvBackupTarget } from '../targets/csv-backup.target';
import { BackupService } from '../backup.service';
import { MockStorageProvider } from '../storage/mock-storage.provider';
import { prisma } from '../../../lib/prisma.js';

describe('CsvBackupTarget', () => {
  let storageProvider: MockStorageProvider;
  let backupService: BackupService;

  beforeEach(async () => {
    storageProvider = new MockStorageProvider();
    backupService = new BackupService(storageProvider);
    // テストデータをクリーンアップ（他のテストの影響を防ぐ）
    await prisma.employee.deleteMany({});
    await prisma.item.deleteMany({});
  });

  afterEach(async () => {
    // テストデータをクリーンアップ
    await prisma.employee.deleteMany({});
    await prisma.item.deleteMany({});
  });

  it('should backup employees CSV', async () => {
    // テストデータを作成（一意のemployeeCodeを使用）
    const timestamp = Date.now();
    const uniqueCode = `EMP${timestamp.toString().slice(-6)}`;
    const employee = await prisma.employee.create({
      data: {
        employeeCode: uniqueCode,
        displayName: 'テスト従業員',
        nfcTagUid: `04C362E1330289${timestamp}`,
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
    expect(csvContent).toContain(employee.employeeCode);
    expect(csvContent).toContain('テスト従業員');
  });

  it('should backup items CSV', async () => {
    // テストデータを作成（一意のitemCodeを使用）
    const timestamp = Date.now();
    const uniqueCode = `TO${timestamp.toString().slice(-6)}`;
    const item = await prisma.item.create({
      data: {
        itemCode: uniqueCode,
        name: 'テスト工具',
        nfcTagUid: `04DE8366BC2A81${timestamp}`,
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
    expect(csvContent).toContain(item.itemCode);
    expect(csvContent).toContain('テスト工具');
  });
});
