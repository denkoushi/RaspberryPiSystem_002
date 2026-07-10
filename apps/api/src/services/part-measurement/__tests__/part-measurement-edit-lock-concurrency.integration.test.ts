import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { PartMeasurementSheetService } from '../part-measurement-sheet.service.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';

const PRODUCT_NO = 'EDIT-LOCK-CONCURRENCY';
const API_KEYS = ['edit-lock-owner', 'edit-lock-a', 'edit-lock-b'];

async function cleanup(): Promise<void> {
  const session = await prisma.partMeasurementSession.findFirst({ where: { productNo: PRODUCT_NO } });
  if (session) {
    await prisma.partMeasurementResult.deleteMany({ where: { sheet: { sessionId: session.id } } });
    await prisma.partMeasurementSheet.deleteMany({ where: { sessionId: session.id } });
    await prisma.partMeasurementSession.delete({ where: { id: session.id } });
  }
  await prisma.clientDevice.deleteMany({ where: { apiKey: { in: API_KEYS } } });
}

describe('part measurement edit lock concurrency', () => {
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('期限切れロックを同時取得しても1端末だけが所有する', async () => {
    const [owner, clientA, clientB] = await Promise.all(API_KEYS.map((apiKey) =>
      prisma.clientDevice.create({ data: { name: `Test ${apiKey}`, apiKey } })));
    const session = await prisma.partMeasurementSession.create({
      data: { productNo: PRODUCT_NO, processGroup: 'CUTTING', resourceCd: 'LOCK' },
    });
    const sheet = await prisma.partMeasurementSheet.create({
      data: {
        productNo: PRODUCT_NO,
        fseiban: 'LOCK-SEIBAN',
        fhincd: 'LOCK-PART',
        fhinmei: 'Lock test part',
        processGroupSnapshot: 'CUTTING',
        sessionId: session.id,
        editLockClientDeviceId: owner!.id,
        editLockExpiresAt: new Date(Date.now() - 60_000),
      },
    });
    const service = new PartMeasurementSheetService();

    const results = await Promise.allSettled([
      service.transferEditLock(sheet.id, clientA!.id, false),
      service.transferEditLock(sheet.id, clientB!.id, false),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejection = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejection.reason).toMatchObject({
      statusCode: 409,
      code: 'PART_MEASUREMENT_TRANSFER_CONFIRM_REQUIRED',
    });
    const stored = await prisma.partMeasurementSheet.findUniqueOrThrow({ where: { id: sheet.id } });
    expect([clientA!.id, clientB!.id]).toContain(stored.editLockClientDeviceId);
    expect(stored.editLockExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });
});
