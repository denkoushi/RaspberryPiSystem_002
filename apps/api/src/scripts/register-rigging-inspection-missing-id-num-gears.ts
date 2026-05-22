/**
 * Gmail 吊具点検 CSV で control_num 空・ID_num のみの行向けに、
 * RiggingGear.idNum を登録する（既存 idNum はスキップ）。
 *
 * ローカル:
 *   pnpm --filter @raspi-system/api register:rigging-inspection-missing-id-num-gears
 *   pnpm --filter @raspi-system/api register:rigging-inspection-missing-id-num-gears -- --dry-run
 *
 * 本番（Pi5 API コンテナ内）:
 *   docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api \
 *     pnpm register:rigging-inspection-missing-id-num-gears:prod --dry-run
 */

import { RiggingStatus } from '@prisma/client';

import { prisma } from '../lib/prisma.js';

type GearStub = {
  idNum: string;
  name: string;
  storageLocation?: string;
};

/** 2026-05-22 CSV で unmatchedGear だった idNum（control_num 空） */
const GEAR_STUBS: readonly GearStub[] = [
  { idNum: '80', name: 'ナイロンスリング', storageLocation: 'FJV' },
  { idNum: '73', name: 'ナイロンスリング', storageLocation: 'N7東' },
  { idNum: '69', name: 'ワイヤースリング', storageLocation: 'MCR北' },
  { idNum: '82', name: 'ナイロンスリング', storageLocation: '森精機' },
];

async function main(): Promise<number> {
  const dryRun = process.argv.includes('--dry-run');
  let created = 0;
  let skipped = 0;

  for (const stub of GEAR_STUBS) {
    const existing = await prisma.riggingGear.findFirst({
      where: { idNum: stub.idNum },
      select: { id: true, managementNumber: true },
    });
    if (existing) {
      skipped += 1;
      console.log('[register-rigging-inspection-missing-id-num-gears] skip existing idNum=', stub.idNum, existing.managementNumber);
      continue;
    }

    const managementNumber = stub.idNum;
    const mgmtTaken = await prisma.riggingGear.findUnique({
      where: { managementNumber },
      select: { id: true },
    });
    if (mgmtTaken) {
      throw new Error(
        `[register-rigging-inspection-missing-id-num-gears] managementNumber conflict: ${managementNumber} (idNum=${stub.idNum})`,
      );
    }

    if (dryRun) {
      console.log('[register-rigging-inspection-missing-id-num-gears] would create', stub);
      created += 1;
      continue;
    }

    await prisma.riggingGear.create({
      data: {
        name: stub.name,
        managementNumber,
        idNum: stub.idNum,
        storageLocation: stub.storageLocation ?? null,
        status: RiggingStatus.AVAILABLE,
        notes: JSON.stringify({ source: 'register-rigging-inspection-missing-id-num-gears' }),
      },
    });
    created += 1;
    console.log('[register-rigging-inspection-missing-id-num-gears] created idNum=', stub.idNum, 'mgmt=', managementNumber);
  }

  console.log(
    '[register-rigging-inspection-missing-id-num-gears] Done:',
    JSON.stringify({ dryRun, created, skipped, total: GEAR_STUBS.length }),
  );
  return 0;
}

void main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error('[register-rigging-inspection-missing-id-num-gears] Error:', err);
    process.exitCode = 1;
  })
  .finally(() =>
    prisma.$disconnect().catch(() => {
      /* ignore */
    }),
  );
