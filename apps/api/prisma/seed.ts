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
        measuringInstrumentId_rfidTagUid: {
          measuringInstrumentId: created.id,
          rfidTagUid: `MI-${inst.managementNumber}`
        }
      },
      update: {},
      create: {
        measuringInstrumentId: created.id,
        rfidTagUid: `MI-${inst.managementNumber}`
      }
    });
  }

  console.log('Seed data inserted. 管理者アカウント: admin / admin1234');
  console.log('計測機器テストデータ: MI-001（期限切れ）, MI-002（期限間近）, MI-003（正常）');
}

main()
  .catch((error) => {
    console.error('Seed failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
