import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignageService, signageScheduleMatchesClientDeviceId } from '../signage.service.js';
import { prisma } from '../../../lib/prisma.js';

const deviceId = '11111111-1111-4111-8111-111111111111';
const credential = 'fixture-only-device-credential';

const schedule = (id: string, targets: string[], dayOfWeek: number[]) => ({
  id, targetClientDeviceIds: targets, targetClientKeys: [] as string[],
  name: id, contentType: 'TOOLS', pdfId: null, layoutConfig: null,
  dayOfWeek, startTime: '00:00', endTime: '23:59', priority: 0, enabled: true,
});

function scheduleDatabase(rows: ReturnType<typeof schedule>[]) {
  return {
    findMany: vi.fn(async ({ where }) => where.targetClientDeviceIds
      ? rows.filter((row) => row.targetClientDeviceIds.length === 0 && row.targetClientKeys.length > 0)
        .map((row) => ({ id: row.id, targetClientKeys: [...row.targetClientKeys], enabled: row.enabled }))
      : rows.filter((row) => where.enabled === undefined || row.enabled === where.enabled)),
    updateMany: vi.fn(async ({ where, data }) => {
      const row = rows.find((row) => row.id === where.id && row.targetClientDeviceIds.length === 0);
      if (!row) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    }),
  };
}

describe('signage device target matching', () => {
  afterEach(() => vi.restoreAllMocks());

  it('matches IDs and keeps empty targets global', () => {
    expect(signageScheduleMatchesClientDeviceId([], null)).toBe(true);
    expect(signageScheduleMatchesClientDeviceId([deviceId], deviceId)).toBe(true);
    for (const value of [null, '', credential, 'another-device']) {
      expect(signageScheduleMatchesClientDeviceId([deviceId], value)).toBe(false);
    }
  });

  it.each([credential, 'unknown-credential', null])('resolves request %s before selecting content', async (clientKey) => {
    const findUnique = vi.fn(async () => clientKey === credential ? { id: deviceId } : null);
    const db = {
      clientDevice: { findUnique },
      signageSchedule: scheduleDatabase([
        schedule('targeted', [deviceId], [0, 1, 2, 3, 4, 5, 6]),
        schedule('global', [], []),
      ]),
    };
    vi.spyOn(prisma.signageEmergency, 'findFirst').mockResolvedValue(null);
    const service = new SignageService(db as never);
    const buildResponse = vi.spyOn(service as unknown as {
      buildScheduleResponse(value: { id: string }): Promise<unknown>;
    }, 'buildScheduleResponse').mockImplementation(async (value) => ({ scheduleId: value.id }));

    expect(await service.getContent({ clientKey })).toEqual({
      scheduleId: clientKey === credential ? 'targeted' : 'global',
    });
    expect(buildResponse).toHaveBeenCalledOnce();
    if (clientKey) expect(findUnique).toHaveBeenCalledWith({ where: { apiKey: clientKey }, select: { id: true } });
    else expect(findUnique).not.toHaveBeenCalled();
  });

  it.each(['getSchedules', 'listSchedulesForManagement'] as const)('repairs legacy targets before reading via %s', async (method) => {
    const secondDevice = { id: 'second-device', apiKey: 'second-key' };
    const rows = [
      { ...schedule('legacy', [], []), targetClientKeys: [secondDevice.apiKey, 'missing', credential] },
      { ...schedule('unknown', [], []), targetClientKeys: ['missing'] },
      schedule('normal', [deviceId], []),
      schedule('global', [], []),
    ];
    const findMany = vi.fn().mockResolvedValue([{ id: deviceId, apiKey: credential }, secondDevice]);
    const signageSchedule = scheduleDatabase(rows);
    const service = new SignageService({ clientDevice: { findMany }, signageSchedule } as never);
    const summaries = await service[method]();
    const legacy = summaries.find((row) => row.id === 'legacy')!;
    expect(legacy.targetClientDeviceIds).toEqual([secondDevice.id, deviceId]);
    expect(legacy.targetClientKeys).toEqual([secondDevice.apiKey, credential]);
    expect(signageSchedule.findMany).toHaveBeenNthCalledWith(1, {
      where: { targetClientDeviceIds: { isEmpty: true }, targetClientKeys: { isEmpty: false } },
      select: { id: true, targetClientKeys: true, enabled: true },
    });
    expect(signageSchedule.updateMany).toHaveBeenCalledWith({
      where: { id: 'legacy', targetClientDeviceIds: { isEmpty: true } },
      data: { targetClientDeviceIds: [secondDevice.id, deviceId], targetClientKeys: [secondDevice.apiKey, credential] },
    });
    expect(signageSchedule.updateMany).toHaveBeenCalledWith({
      where: { id: 'unknown', targetClientDeviceIds: { isEmpty: true } },
      data: { targetClientDeviceIds: [], enabled: false },
    });
    expect(rows[1]).toMatchObject({ targetClientDeviceIds: [], targetClientKeys: ['missing'], enabled: false });
    expect(summaries.some((row) => row.targetClientDeviceIds.includes(''))).toBe(false);
    if (method === 'getSchedules') expect(summaries.some((row) => row.id === 'unknown')).toBe(false);
    else expect(summaries.find((row) => row.id === 'unknown')?.enabled).toBe(false);
    expect(signageScheduleMatchesClientDeviceId(legacy.targetClientDeviceIds, deviceId)).toBe(true);
    expect(signageScheduleMatchesClientDeviceId(legacy.targetClientDeviceIds, 'another-device')).toBe(false);
    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      where: { apiKey: { in: [secondDevice.apiKey, 'missing', credential] } }, select: { id: true, apiKey: true },
    });
  });

  it.each([true, false])('preserves a concurrent ID write when legacy keys resolve: %s', async (resolves) => {
    const row = { ...schedule('legacy', [], []), targetClientKeys: [credential] };
    const signageSchedule = scheduleDatabase([row]);
    const findMany = vi.fn(async () => {
      row.targetClientDeviceIds = ['concurrent-device'];
      row.targetClientKeys = ['concurrent-key'];
      return resolves ? [{ id: deviceId, apiKey: credential }] : [];
    });
    const service = new SignageService({ clientDevice: { findMany }, signageSchedule } as never);
    expect(await service.getSchedules()).toEqual([row]);
    expect(row).toMatchObject({
      targetClientDeviceIds: ['concurrent-device'], targetClientKeys: ['concurrent-key'], enabled: true,
    });
    expect(signageSchedule.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'legacy', targetClientDeviceIds: { isEmpty: true } },
    }));
    await expect(signageSchedule.updateMany.mock.results[0].value).resolves.toEqual({ count: 0 });
  });

  it('skips legacy lookup for normal and global rows', async () => {
    const findMany = vi.fn();
    const rows = [schedule('normal', [deviceId], []), schedule('global', [], [])];
    const signageSchedule = scheduleDatabase(rows);
    const service = new SignageService({ clientDevice: { findMany }, signageSchedule } as never);
    expect(await service.getSchedules()).toEqual(rows);
    expect(findMany).not.toHaveBeenCalled();
    expect(signageSchedule.updateMany).not.toHaveBeenCalled();
  });

  it.each([credential, 'other-credential', null])('selects legacy content only for its device: %s', async (clientKey) => {
    const db = {
      clientDevice: {
        findUnique: vi.fn(async () => clientKey === credential ? { id: deviceId } : { id: 'other-device' }),
        findMany: vi.fn().mockResolvedValue([{ id: deviceId, apiKey: credential }]),
      },
      signageSchedule: scheduleDatabase([
        { ...schedule('unknown', [], [0, 1, 2, 3, 4, 5, 6]), targetClientKeys: ['missing'] },
        { ...schedule('legacy', [], [0, 1, 2, 3, 4, 5, 6]), targetClientKeys: [credential] },
        schedule('global', [], []),
      ]),
    };
    vi.spyOn(prisma.signageEmergency, 'findFirst').mockResolvedValue(null);
    const service = new SignageService(db as never);
    vi.spyOn(service as unknown as {
      buildScheduleResponse(value: { id: string }): Promise<unknown>;
    }, 'buildScheduleResponse').mockImplementation(async (value) => ({ scheduleId: value.id }));
    expect(await service.getContent({ clientKey })).toEqual({ scheduleId: clientKey === credential ? 'legacy' : 'global' });
  });

  it('lists renderer device IDs without selecting credentials', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: deviceId }]);
    const service = new SignageService({ clientDevice: { findMany } } as never);
    expect(await service.listSignageRenderClientDeviceIds()).toEqual([deviceId]);
    expect(findMany).toHaveBeenCalledWith({ select: { id: true }, orderBy: { id: 'asc' } });
  });
});
