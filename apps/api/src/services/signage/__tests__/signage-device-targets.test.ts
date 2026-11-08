import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignageService, signageScheduleMatchesClientDeviceId } from '../signage.service.js';
import { prisma } from '../../../lib/prisma.js';

const deviceId = '11111111-1111-4111-8111-111111111111';
const credential = 'fixture-only-device-credential';

const schedule = (id: string, targets: string[], dayOfWeek: number[]) => ({
  id, targetClientDeviceIds: targets, targetClientKeys: [],
  name: id, contentType: 'TOOLS', pdfId: null, layoutConfig: null,
  dayOfWeek, startTime: '00:00', endTime: '23:59', priority: 0, enabled: true,
});

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
      signageSchedule: { findMany: vi.fn().mockResolvedValue([
        schedule('targeted', [deviceId], [0, 1, 2, 3, 4, 5, 6]),
        schedule('global', [], []),
      ]) },
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

  it.each(['getSchedules', 'listSchedulesForManagement'] as const)('resolves legacy targets in one query via %s', async (method) => {
    const secondDevice = { id: 'second-device', apiKey: 'second-key' };
    const rows = [
      { ...schedule('legacy', [], []), targetClientKeys: [secondDevice.apiKey, 'missing', credential] },
      { ...schedule('unknown', [], []), targetClientKeys: ['missing'] },
      schedule('normal', [deviceId], []),
      schedule('global', [], []),
    ];
    const findMany = vi.fn().mockResolvedValue([{ id: deviceId, apiKey: credential }, secondDevice]);
    const service = new SignageService({
      clientDevice: { findMany }, signageSchedule: { findMany: vi.fn().mockResolvedValue(rows) },
    } as never);
    const summaries = await service[method]();
    expect(summaries[0].targetClientDeviceIds).toEqual([secondDevice.id, deviceId]);
    expect(summaries[1].targetClientDeviceIds).toHaveLength(1);
    for (const candidate of [deviceId, secondDevice.id, 'another-device', '', null]) {
      expect(signageScheduleMatchesClientDeviceId(summaries[1].targetClientDeviceIds, candidate)).toBe(false);
      expect(signageScheduleMatchesClientDeviceId(summaries[3].targetClientDeviceIds, candidate)).toBe(true);
    }
    expect(summaries[2]).toEqual(rows[2]);
    expect(rows[0].targetClientDeviceIds).toEqual([]);
    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      where: { apiKey: { in: [secondDevice.apiKey, 'missing', credential] } }, select: { id: true, apiKey: true },
    });
  });

  it('skips legacy lookup for normal and global rows', async () => {
    const findMany = vi.fn();
    const rows = [schedule('normal', [deviceId], []), schedule('global', [], [])];
    const service = new SignageService({
      clientDevice: { findMany }, signageSchedule: { findMany: vi.fn().mockResolvedValue(rows) },
    } as never);
    expect(await service.getSchedules()).toEqual(rows);
    expect(findMany).not.toHaveBeenCalled();
  });

  it.each([credential, 'other-credential', null])('selects legacy content only for its device: %s', async (clientKey) => {
    const db = {
      clientDevice: {
        findUnique: vi.fn(async () => clientKey === credential ? { id: deviceId } : { id: 'other-device' }),
        findMany: vi.fn().mockResolvedValue([{ id: deviceId, apiKey: credential }]),
      },
      signageSchedule: { findMany: vi.fn().mockResolvedValue([
        { ...schedule('unknown', [], [0, 1, 2, 3, 4, 5, 6]), targetClientKeys: ['missing'] },
        { ...schedule('legacy', [], [0, 1, 2, 3, 4, 5, 6]), targetClientKeys: [credential] },
        schedule('global', [], []),
      ]) },
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
