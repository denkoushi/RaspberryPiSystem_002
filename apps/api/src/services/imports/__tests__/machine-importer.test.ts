import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MachineCsvImporter } from '../importers/machine.js';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), deleteMany: vi.fn(),
}));
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({ machine: mocks }),
  },
}));

describe('MachineCsvImporter', () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([false, true])('既存の資源CDをCSV取込で保持する（全置換: %s）', async (replaceExisting) => {
    const existing = {
      equipmentManagementNumber: '10018', name: '旧名称', resourceCd: '021',
      shortName: null, classification: null, operatingStatus: null, ncManual: null,
      maker: null, processClassification: null, coolant: null,
    };
    mocks.findUnique.mockResolvedValue(existing);
    mocks.update.mockImplementation(async ({ data }) => Object.assign(existing, data));
    const importer = new MachineCsvImporter({ getEffectiveConfig: vi.fn().mockResolvedValue(null) } as any);
    const rows = await importer.parse(Buffer.from('設備管理番号,加工機_名称\n10018,新名称'));
    const result = await importer.import(rows, replaceExisting);
    expect(result).toEqual({ processed: 1, created: 0, updated: 1 });
    expect(mocks.update).toHaveBeenCalledWith({ where: { equipmentManagementNumber: '10018' }, data: { name: '新名称' } });
    expect(existing).toMatchObject({ name: '新名称', resourceCd: '021' });
    expect(mocks.create).not.toHaveBeenCalled();
    if (replaceExisting) {
      expect(mocks.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { equipmentManagementNumber: { notIn: ['10018'] } } });
    } else {
      expect(mocks.deleteMany).not.toHaveBeenCalled();
    }
  });

  it('列定義を使って日本語ヘッダーCSVをパースできる', async () => {
    const configService = {
      getEffectiveConfig: vi.fn().mockResolvedValue({
        columnDefinitions: [
          {
            internalName: 'equipmentManagementNumber',
            displayName: '設備管理番号',
            csvHeaderCandidates: ['設備管理番号'],
            dataType: 'string',
            order: 0,
            required: true,
          },
          {
            internalName: 'name',
            displayName: '加工機名称',
            csvHeaderCandidates: ['加工機_名称'],
            dataType: 'string',
            order: 1,
            required: true,
          },
          {
            internalName: 'operatingStatus',
            displayName: '稼働状態',
            csvHeaderCandidates: ['稼働状態'],
            dataType: 'string',
            order: 2,
            required: false,
          },
        ],
      }),
    };

    const importer = new MachineCsvImporter(configService as any);
    const csv = [
      '設備管理番号,加工機_名称,稼働状態',
      '30024,HS3A_10P,稼働中',
    ].join('\n');

    const rows = await importer.parse(Buffer.from(csv, 'utf-8'));
    expect(rows).toEqual([
      {
        equipmentManagementNumber: '30024',
        name: 'HS3A_10P',
        operatingStatus: '稼働中',
      },
    ]);
  });

  it('デフォルト列定義を使って日本語ヘッダーCSVをパースできる', async () => {
    const configService = {
      getEffectiveConfig: vi.fn().mockResolvedValue(null), // 列定義が存在しない場合
    };

    const importer = new MachineCsvImporter(configService as any);
    const csv = [
      '加工機_名称,加工機_略称,設備管理番号,加工機分類,稼働状態,NC_Manual,maker,工程分類,クーラント',
      'PSG-2015,PSG-2015,50038R,平面研削盤,稼働中,NC,岡本,研削,THK_Ｉ_ジュラロン',
    ].join('\n');

    const rows = await importer.parse(Buffer.from(csv, 'utf-8'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      equipmentManagementNumber: '50038R',
      name: 'PSG-2015',
      shortName: 'PSG-2015',
      classification: '平面研削盤',
      operatingStatus: '稼働中',
      ncManual: 'NC',
      maker: '岡本',
      processClassification: '研削',
      coolant: 'THK_Ｉ_ジュラロン',
    });
  });

  it('実際のCSVファイル（加工機_マスター.csv）をパースできる', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const csvPath = path.join(process.env.HOME || '', 'Downloads', '加工機_マスター.csv');
    
    // ファイルが存在する場合のみテストを実行
    if (!fs.existsSync(csvPath)) {
      console.log('⚠️  テストファイルが見つかりません:', csvPath);
      return;
    }

    const configService = {
      getEffectiveConfig: vi.fn().mockResolvedValue(null), // 列定義が存在しない場合
    };

    const importer = new MachineCsvImporter(configService as any);
    const csvBuffer = fs.readFileSync(csvPath);
    
    const rows = await importer.parse(csvBuffer);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty('equipmentManagementNumber');
    expect(rows[0]).toHaveProperty('name');
    expect(rows[0].equipmentManagementNumber).toBeTruthy();
    expect(rows[0].name).toBeTruthy();
    
    // 最初の行を確認
    expect(rows[0]).toMatchObject({
      equipmentManagementNumber: '50038R',
      name: 'PSG-2015',
    });
  });
});
