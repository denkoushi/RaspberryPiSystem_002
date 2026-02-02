import {
  PrismaClient,
  EmployeeStatus,
  ItemStatus,
  UserRole,
  UserStatus,
  MeasuringInstrumentStatus
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // 生産日程（研削工程）: ダッシュボードIDを固定（CI/E2Eで安定させる）
  const productionScheduleDashboardId = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01';
  const productionScheduleGmailSubjectPattern = '生産日程_三島_研削工程';

  const passwordHash = await bcrypt.hash('admin1234', 10);
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: { status: UserStatus.ACTIVE },
    create: {
      username: 'admin',
      passwordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE
    }
  });

  const employees = [
    {
      employeeCode: 'EMP-001',
      displayName: '山田 太郎',
      nfcTagUid: '04C362E1330289',
      department: '製造1課'
    },
    {
      employeeCode: 'EMP-002',
      displayName: '佐藤 花子',
      nfcTagUid: '0411223344',
      department: '品質管理'
    }
  ];

  for (const emp of employees) {
    await prisma.employee.upsert({
      where: { employeeCode: emp.employeeCode },
      update: emp,
      create: {
        ...emp,
        status: EmployeeStatus.ACTIVE
      }
    });
  }

  const items = [
    {
      itemCode: 'ITEM-001',
      name: 'トルクレンチ #1',
      nfcTagUid: '04DE8366BC2A81',
      category: '工具',
      storageLocation: 'A-01'
    },
    {
      itemCode: 'ITEM-002',
      name: '電動ドリル #3',
      nfcTagUid: '0400112233',
      category: '工具',
      storageLocation: 'B-12'
    }
  ];

  for (const item of items) {
    await prisma.item.upsert({
      where: { itemCode: item.itemCode },
      update: item,
      create: {
        ...item,
        status: ItemStatus.AVAILABLE
      }
    });
  }

  // CI向け: デフォルトのクライアントキーを2種類用意しておく
  // - client-demo-key（既存互換）
  // - client-key-raspberrypi4-kiosk1（kioskデフォルトキー）
  const clientDevices = [
    {
      apiKey: 'client-demo-key',
      name: 'Pi4 Station 01',
      location: '出入口',
      defaultMode: 'TAG' as const
    },
    {
      apiKey: 'client-key-raspberrypi4-kiosk1',
      name: 'Pi4 Station 02',
      location: '工場入口',
      defaultMode: 'TAG' as const
    }
  ];

  for (const client of clientDevices) {
    await prisma.clientDevice.upsert({
      where: { apiKey: client.apiKey },
      update: { name: client.name, location: client.location, defaultMode: client.defaultMode },
      create: client
    });
  }

  // 生産日程（研削工程）用のCSVダッシュボードを作成（キオスク表示のデータソース）
  await prisma.csvDashboard.upsert({
    where: { id: productionScheduleDashboardId },
    update: {
      name: 'ProductionSchedule_Mishima_Grinding',
      description: '生産日程（研削工程）',
      gmailSubjectPattern: productionScheduleGmailSubjectPattern,
      enabled: true,
      ingestMode: 'DEDUP',
      dedupKeyColumns: ['ProductNo', 'FSEIBAN', 'FHINCD', 'FSIGENCD', 'FKOJUN'],
      dateColumnName: 'registeredAt',
      displayPeriodDays: 1,
      emptyMessage: '仕掛中のデータはありません',
      columnDefinitions: [
        { internalName: 'ProductNo', displayName: '製造order番号', csvHeaderCandidates: ['ProductNo'], dataType: 'string', order: 0 },
        { internalName: 'FSIGENMEI', displayName: '資源名', csvHeaderCandidates: ['FSIGENMEI'], dataType: 'string', order: 1 },
        { internalName: 'FSEIBAN', displayName: '製番', csvHeaderCandidates: ['FSEIBAN'], dataType: 'string', order: 2 },
        { internalName: 'FHINCD', displayName: '製品コード', csvHeaderCandidates: ['FHINCD'], dataType: 'string', order: 3 },
        { internalName: 'FHINMEI', displayName: '品名', csvHeaderCandidates: ['FHINMEI'], dataType: 'string', order: 4 },
        { internalName: 'FSIGENCD', displayName: '資源コード', csvHeaderCandidates: ['FSIGENCD'], dataType: 'string', order: 5 },
        { internalName: 'FSIGENSHOYORYO', displayName: '所要時間', csvHeaderCandidates: ['FSIGENSHOYORYO'], dataType: 'number', order: 6 },
        { internalName: 'FKOJUN', displayName: '工順', csvHeaderCandidates: ['FKOJUN'], dataType: 'string', order: 7 },
        { internalName: 'progress', displayName: '進捗', csvHeaderCandidates: ['progress'], dataType: 'string', order: 8, required: false },
        { internalName: 'updatedAt', displayName: '更新日時', csvHeaderCandidates: ['更新日時'], dataType: 'date', order: 9, required: false },
        { internalName: 'registeredAt', displayName: '登録日時', csvHeaderCandidates: ['登録日時'], dataType: 'date', order: 10, required: false }
      ],
      templateType: 'TABLE',
      templateConfig: {
        rowsPerPage: 50,
        fontSize: 14,
        displayColumns: ['FHINCD', 'ProductNo', 'FHINMEI', 'FSIGENCD', 'FSIGENSHOYORYO', 'FKOJUN', 'FSEIBAN'],
        headerFixed: true
      }
    },
    create: {
      id: productionScheduleDashboardId,
      name: 'ProductionSchedule_Mishima_Grinding',
      description: '生産日程（研削工程）',
      gmailSubjectPattern: productionScheduleGmailSubjectPattern,
      enabled: true,
      ingestMode: 'DEDUP',
      dedupKeyColumns: ['ProductNo', 'FSEIBAN', 'FHINCD', 'FSIGENCD', 'FKOJUN'],
      dateColumnName: 'registeredAt',
      displayPeriodDays: 1,
      emptyMessage: '仕掛中のデータはありません',
      columnDefinitions: [
        { internalName: 'ProductNo', displayName: '製造order番号', csvHeaderCandidates: ['ProductNo'], dataType: 'string', order: 0 },
        { internalName: 'FSIGENMEI', displayName: '資源名', csvHeaderCandidates: ['FSIGENMEI'], dataType: 'string', order: 1 },
        { internalName: 'FSEIBAN', displayName: '製番', csvHeaderCandidates: ['FSEIBAN'], dataType: 'string', order: 2 },
        { internalName: 'FHINCD', displayName: '製品コード', csvHeaderCandidates: ['FHINCD'], dataType: 'string', order: 3 },
        { internalName: 'FHINMEI', displayName: '品名', csvHeaderCandidates: ['FHINMEI'], dataType: 'string', order: 4 },
        { internalName: 'FSIGENCD', displayName: '資源コード', csvHeaderCandidates: ['FSIGENCD'], dataType: 'string', order: 5 },
        { internalName: 'FSIGENSHOYORYO', displayName: '所要時間', csvHeaderCandidates: ['FSIGENSHOYORYO'], dataType: 'number', order: 6 },
        { internalName: 'FKOJUN', displayName: '工順', csvHeaderCandidates: ['FKOJUN'], dataType: 'string', order: 7 },
        { internalName: 'progress', displayName: '進捗', csvHeaderCandidates: ['progress'], dataType: 'string', order: 8, required: false },
        { internalName: 'updatedAt', displayName: '更新日時', csvHeaderCandidates: ['更新日時'], dataType: 'date', order: 9, required: false },
        { internalName: 'registeredAt', displayName: '登録日時', csvHeaderCandidates: ['登録日時'], dataType: 'date', order: 10, required: false }
      ],
      templateType: 'TABLE',
      templateConfig: {
        rowsPerPage: 50,
        fontSize: 14,
        displayColumns: ['FHINCD', 'ProductNo', 'FHINMEI', 'FSIGENCD', 'FSIGENSHOYORYO', 'FKOJUN', 'FSEIBAN'],
        headerFixed: true
      }
    }
  });

  // 計測機器の持出状況用のCSVダッシュボードを作成（サイネージ表示のデータソース）
  const measuringInstrumentLoansDashboardId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const measuringInstrumentLoansGmailSubjectPattern = '計測機器持出状況';
  await prisma.csvDashboard.upsert({
    where: { id: measuringInstrumentLoansDashboardId },
    update: {
      name: 'MeasuringInstrumentLoans',
      description: '計測機器の持出状況（PowerApps連携）',
      gmailSubjectPattern: measuringInstrumentLoansGmailSubjectPattern,
      enabled: true,
      ingestMode: 'DEDUP',
      dedupKeyColumns: ['managementNumber', 'borrowedAt'],
      dateColumnName: 'borrowedAt',
      displayPeriodDays: 7,
      templateType: 'TABLE',
      templateConfig: {
        rowsPerPage: 50,
        fontSize: 14,
        displayColumns: ['managementNumber', 'name', 'borrower', 'borrowedAt', 'expectedReturnAt'],
        headerFixed: true
      }
    },
    create: {
      id: measuringInstrumentLoansDashboardId,
      name: 'MeasuringInstrumentLoans',
      description: '計測機器の持出状況（PowerApps連携）',
      gmailSubjectPattern: measuringInstrumentLoansGmailSubjectPattern,
      enabled: true,
      ingestMode: 'DEDUP',
      dedupKeyColumns: ['managementNumber', 'borrowedAt'],
      dateColumnName: 'borrowedAt',
      displayPeriodDays: 7,
      emptyMessage: '持出中の計測機器はありません',
      columnDefinitions: [
        { internalName: 'managementNumber', displayName: '管理番号', csvHeaderCandidates: ['managementNumber', '管理番号'], dataType: 'string', order: 0 },
        { internalName: 'name', displayName: '名称', csvHeaderCandidates: ['name', '名称'], dataType: 'string', order: 1 },
        { internalName: 'borrower', displayName: '持出従業員', csvHeaderCandidates: ['borrower', '持出従業員', 'employeeName'], dataType: 'string', order: 2 },
        { internalName: 'borrowedAt', displayName: '持出日時', csvHeaderCandidates: ['borrowedAt', '持出日時', 'borrowedDate'], dataType: 'date', order: 3 },
        { internalName: 'expectedReturnAt', displayName: '返却予定日時', csvHeaderCandidates: ['expectedReturnAt', '返却予定日時', 'expectedReturnDate'], dataType: 'date', order: 4, required: false },
        { internalName: 'status', displayName: '状態', csvHeaderCandidates: ['status', '状態'], dataType: 'string', order: 5, required: false }
      ],
      templateType: 'TABLE',
      templateConfig: {
        rowsPerPage: 50,
        fontSize: 14,
        displayColumns: ['managementNumber', 'name', 'borrower', 'borrowedAt', 'expectedReturnAt'],
        headerFixed: true
      }
    }
  });

  // CSVインポート件名パターンのデフォルトデータを投入
  const defaultSubjectPatterns = [
    { importType: 'employees', pattern: '[Pi5 CSV Import] employees', priority: 0 },
    { importType: 'employees', pattern: '[CSV Import] employees', priority: 1 },
    { importType: 'employees', pattern: 'CSV Import - employees', priority: 2 },
    { importType: 'employees', pattern: '従業員CSVインポート', priority: 3 },
    { importType: 'items', pattern: '[Pi5 CSV Import] items', priority: 0 },
    { importType: 'items', pattern: '[CSV Import] items', priority: 1 },
    { importType: 'items', pattern: 'CSV Import - items', priority: 2 },
    { importType: 'items', pattern: 'アイテムCSVインポート', priority: 3 },
    { importType: 'measuringInstruments', pattern: '[Pi5 CSV Import] measuring-instruments', priority: 0 },
    { importType: 'measuringInstruments', pattern: '[CSV Import] measuring-instruments', priority: 1 },
    { importType: 'measuringInstruments', pattern: 'CSV Import - measuring-instruments', priority: 2 },
    { importType: 'measuringInstruments', pattern: '計測機器CSVインポート', priority: 3 },
    { importType: 'riggingGears', pattern: '[Pi5 CSV Import] rigging-gears', priority: 0 },
    { importType: 'riggingGears', pattern: '[CSV Import] rigging-gears', priority: 1 },
    { importType: 'riggingGears', pattern: 'CSV Import - rigging-gears', priority: 2 },
    { importType: 'riggingGears', pattern: '吊具CSVインポート', priority: 3 },
  ];

  for (const pattern of defaultSubjectPatterns) {
    await prisma.csvImportSubjectPattern.upsert({
      where: {
        importType_pattern: {
          importType: pattern.importType as 'employees' | 'items' | 'measuringInstruments' | 'riggingGears',
          pattern: pattern.pattern,
        },
      },
      update: {
        priority: pattern.priority,
        enabled: true,
      },
      create: {
        importType: pattern.importType as 'employees' | 'items' | 'measuringInstruments' | 'riggingGears',
        pattern: pattern.pattern,
        priority: pattern.priority,
        enabled: true,
      },
    });
  }

  // 計測機器のテストデータ（実機検証用）
  const now = new Date();
  const overdueDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10日前（期限切れ）
  const soonDate = new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000); // 20日後（期限間近）
  const normalDate = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90日後（正常）

  const measuringInstruments = [
    {
      managementNumber: 'MI-001',
      name: 'デジタルマルチメータ',
      storageLocation: '計測機器庫A',
      measurementRange: 'DC 0-1000V, AC 0-750V',
      calibrationExpiryDate: overdueDate,
      status: MeasuringInstrumentStatus.AVAILABLE
    },
    {
      managementNumber: 'MI-002',
      name: 'ノギス',
      storageLocation: '計測機器庫B',
      measurementRange: '0-200mm',
      calibrationExpiryDate: soonDate,
      status: MeasuringInstrumentStatus.AVAILABLE
    },
    {
      managementNumber: 'MI-003',
      name: 'トルクレンチ',
      storageLocation: '計測機器庫A',
      measurementRange: '5-50N・m',
      calibrationExpiryDate: normalDate,
      status: MeasuringInstrumentStatus.AVAILABLE
    }
  ];

  for (const inst of measuringInstruments) {
    const created = await prisma.measuringInstrument.upsert({
      where: { managementNumber: inst.managementNumber },
      update: inst,
      create: inst
    });

    // 点検項目を追加
    const inspectionItems = [
      {
        measuringInstrumentId: created.id,
        name: '外観点検',
        content: '本体に損傷や汚れがないか確認',
        criteria: '損傷・汚れなし',
        method: '目視確認',
        order: 1
      },
      {
        measuringInstrumentId: created.id,
        name: '表示確認',
        content: 'ディスプレイが正常に表示されるか確認',
        criteria: '正常表示',
        method: '電源投入して確認',
        order: 2
      },
      {
        measuringInstrumentId: created.id,
        name: '校正期限確認',
        content: '校正期限が有効期限内か確認',
        criteria: '有効期限内',
        method: '校正期限ラベルを確認',
        order: 3
      }
    ];

    for (const item of inspectionItems) {
      await prisma.inspectionItem.upsert({
        where: {
          measuringInstrumentId_name: {
            measuringInstrumentId: item.measuringInstrumentId,
            name: item.name
          }
        },
        update: item,
        create: item
      });
    }

    // RFIDタグの紐付け（テスト用UID）
    await prisma.measuringInstrumentTag.upsert({
      where: {
        rfidTagUid: `MI-${inst.managementNumber}`
      },
      update: {},
      create: {
        measuringInstrumentId: created.id,
        rfidTagUid: `MI-${inst.managementNumber}`
      }
    });
  }

  // 生産スケジュール進捗可視化ダッシュボードを作成（デフォルト）
  const productionScheduleVisualizationDashboardId = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01';
  await prisma.visualizationDashboard.upsert({
    where: { id: productionScheduleVisualizationDashboardId },
    update: {
      name: '生産スケジュール進捗',
      description: '検索登録製番の進捗状況を可視化',
      dataSourceType: 'production_schedule',
      rendererType: 'progress_list',
      dataSourceConfig: {},
      rendererConfig: {},
      enabled: true,
    },
    create: {
      id: productionScheduleVisualizationDashboardId,
      name: '生産スケジュール進捗',
      description: '検索登録製番の進捗状況を可視化',
      dataSourceType: 'production_schedule',
      rendererType: 'progress_list',
      dataSourceConfig: {},
      rendererConfig: {},
      enabled: true,
    },
  });

  console.log('Seed data inserted. 管理者アカウント: admin / admin1234');
  console.log('計測機器テストデータ: MI-001（期限切れ）, MI-002（期限間近）, MI-003（正常）');
  console.log('可視化ダッシュボード: 生産スケジュール進捗（デフォルト）');
}

main()
  .catch((error) => {
    console.error('Seed failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
