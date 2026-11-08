import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerErrorHandler } from '../../plugins/error-handler.js';
import { SignageService } from '../../services/signage/signage.service.js';
import { registerScheduleRoutes } from './schedules.js';

vi.mock('../../lib/auth.js', () => ({ authorizeRoles: () => async () => undefined }));

const device = { id: '11111111-1111-4111-8111-111111111111', apiKey: 'fixture-only-target-credential' };
const scheduleId = '22222222-2222-4222-8222-222222222222';
const input = { name: 'Schedule', contentType: 'TOOLS', dayOfWeek: [1], startTime: '08:00', endTime: '17:00', priority: 0 };

describe('schedule target input and rollback writes', () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

  function fixture() {
    const db = {
      clientDevice: { findMany: vi.fn().mockResolvedValue([device]) },
      signageSchedule: {
        findUnique: vi.fn().mockResolvedValue({ targetClientDeviceIds: [], targetClientKeys: [] }),
        create: vi.fn(async ({ data }) => ({ id: scheduleId, ...data })),
        update: vi.fn(async ({ data }) => ({ id: scheduleId, ...data })),
      },
    };
    const app = Fastify();
    registerErrorHandler(app);
    registerScheduleRoutes(app, new SignageService(db as never));
    apps.push(app);
    return { app, db };
  }

  it.each(['POST', 'PUT'] as const)('dual writes ID targets on %s', async (method) => {
    const { app, db } = fixture();
    const response = await app.inject({ method, url: method === 'POST' ? '/schedules' : `/schedules/${scheduleId}`, payload: {
      ...input, targetClientDeviceIds: [device.id], targetClientKeys: ['ignored-old-input'],
    } });
    expect(response.statusCode).toBe(200);
    expect(response.json().schedule).toMatchObject({ targetClientDeviceIds: [device.id] });
    expect(response.body).not.toContain(device.apiKey);
    expect(JSON.stringify((method === 'POST' ? db.signageSchedule.create : db.signageSchedule.update).mock.calls[0][0].data)).toContain(device.apiKey);
    expect(db.clientDevice.findMany).toHaveBeenCalledWith({ where: { id: { in: [device.id] } }, select: { id: true, apiKey: true } });
  });

  it.each(['POST', 'PUT'] as const)('converts cached legacy input on %s', async (method) => {
    const { app, db } = fixture();
    const response = await app.inject({ method, url: method === 'POST' ? '/schedules' : `/schedules/${scheduleId}`, payload: {
      ...input, targetClientKeys: [device.apiKey],
    } });
    expect(response.statusCode).toBe(200);
    expect(response.json().schedule).toMatchObject({ targetClientDeviceIds: [device.id] });
    expect(response.body).not.toContain(device.apiKey);
    expect(JSON.stringify((method === 'POST' ? db.signageSchedule.create : db.signageSchedule.update).mock.calls[0][0].data)).toContain(device.apiKey);
    expect(db.clientDevice.findMany).toHaveBeenCalledWith({ where: { apiKey: { in: [device.apiKey] } }, select: { id: true, apiKey: true } });
  });

  it('leaves stored targets untouched on a write without targets', async () => {
    const { app, db } = fixture();
    const response = await app.inject({ method: 'PUT', url: `/schedules/${scheduleId}`, payload: { name: 'Renamed' } });
    expect(response.statusCode).toBe(200);
    expect(db.signageSchedule.update).toHaveBeenCalledWith({ where: { id: scheduleId }, data: { name: 'Renamed' } });
    expect(db.clientDevice.findMany).not.toHaveBeenCalled();
    expect(db.signageSchedule.findUnique).not.toHaveBeenCalled();
  });

  it.each([{ targetClientDeviceIds: ['not-an-id'] }, { targetClientDeviceIds: [device.id] }, { targetClientKeys: ['unknown-key'] }])(
    'rejects invalid targets without saving: %j', async (targets) => {
      const { app, db } = fixture();
      db.clientDevice.findMany.mockResolvedValue([]);
      const response = await app.inject({ method: 'POST', url: '/schedules', payload: { ...input, ...targets } });
      expect(response.statusCode).toBe(400);
      expect(db.signageSchedule.create).not.toHaveBeenCalled();
    }
  );

  it.each(['targetClientDeviceIds', 'targetClientKeys'] as const)('drops only stored stale targets on update using %s', async (field) => {
    const { app, db } = fixture();
    const stale = field === 'targetClientDeviceIds' ? '33333333-3333-4333-8333-333333333333' : 'deleted-key';
    const valid = field === 'targetClientDeviceIds' ? device.id : device.apiKey;
    db.signageSchedule.findUnique.mockResolvedValue({ targetClientDeviceIds: [], targetClientKeys: [], [field]: [stale] });
    const response = await app.inject({ method: 'PUT', url: `/schedules/${scheduleId}`, payload: { [field]: [stale, valid] } });
    expect(response.statusCode).toBe(200);
    expect(response.json().schedule).toMatchObject({ targetClientDeviceIds: [device.id] });
    expect(response.body).not.toContain(device.apiKey);
    expect(JSON.stringify(db.signageSchedule.update.mock.calls[0][0].data)).toContain(device.apiKey);
    expect(db.signageSchedule.findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { id: scheduleId }, select: { targetClientDeviceIds: true, targetClientKeys: true },
    });
  });

  it.each(['targetClientDeviceIds', 'targetClientKeys'] as const)('rejects new unknown and entirely stale updates using %s', async (field) => {
    for (const stored of [false, true]) {
      const { app, db } = fixture();
      const unknown = field === 'targetClientDeviceIds' ? '33333333-3333-4333-8333-333333333333' : 'unknown-key';
      const valid = field === 'targetClientDeviceIds' ? device.id : device.apiKey;
      db.signageSchedule.findUnique.mockResolvedValue({ targetClientDeviceIds: [], targetClientKeys: [], [field]: stored ? [unknown] : [] });
      db.clientDevice.findMany.mockResolvedValue(stored ? [] : [device]);
      const response = await app.inject({ method: 'PUT', url: `/schedules/${scheduleId}`, payload: { [field]: stored ? [unknown] : [valid, unknown] } });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ errorCode: 'INVALID_SIGNAGE_TARGET' });
      expect(db.signageSchedule.update).not.toHaveBeenCalled();
    }
  });

  it('clears both target arrays for all terminals', async () => {
    const { app, db } = fixture();
    const response = await app.inject({ method: 'PUT', url: `/schedules/${scheduleId}`, payload: { targetClientDeviceIds: [] } });
    expect(response.statusCode).toBe(200);
    expect(response.json().schedule).toMatchObject({ targetClientDeviceIds: [] });
    expect(db.signageSchedule.update.mock.calls[0][0].data).toMatchObject({ targetClientKeys: [] });
    expect(db.clientDevice.findMany).not.toHaveBeenCalled();
  });
});
