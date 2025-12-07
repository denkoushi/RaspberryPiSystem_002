import { PrismaClient, EmployeeStatus, ItemStatus, UserRole, UserStatus } from '@prisma/client';
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

  console.log('Seed data inserted. 管理者アカウント: admin / admin1234');
}

main()
  .catch((error) => {
    console.error('Seed failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
