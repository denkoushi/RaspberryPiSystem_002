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
        create: vi.fn(async ({ data }) => ({ id: scheduleId, ...data })),
        update: vi.fn(async ({ data }) => ({ id: scheduleId, ...data })),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ targetClientDeviceIds: [device.id] }),
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
    expect(response.json().schedule).toMatchObject({ targetClientDeviceIds: [device.id], targetClientKeys: [device.apiKey] });
    expect(db.clientDevice.findMany).toHaveBeenCalledWith({ where: { id: { in: [device.id] } }, select: { id: true, apiKey: true } });
  });

  it.each(['POST', 'PUT'] as const)('converts cached legacy input on %s', async (method) => {
    const { app, db } = fixture();
    const response = await app.inject({ method, url: method === 'POST' ? '/schedules' : `/schedules/${scheduleId}`, payload: {
      ...input, targetClientKeys: [device.apiKey],
    } });
    expect(response.statusCode).toBe(200);
    expect(response.json().schedule).toMatchObject({ targetClientDeviceIds: [device.id], targetClientKeys: [device.apiKey] });
    expect(db.clientDevice.findMany).toHaveBeenCalledWith({ where: { apiKey: { in: [device.apiKey] } }, select: { id: true, apiKey: true } });
  });

  it('refreshes legacy keys on a write with unchanged targets', async () => {
    const { app, db } = fixture();
    const response = await app.inject({ method: 'PUT', url: `/schedules/${scheduleId}`, payload: { name: 'Renamed' } });
    expect(response.statusCode).toBe(200);
    expect(db.signageSchedule.update).toHaveBeenCalledWith({ where: { id: scheduleId }, data: {
      name: 'Renamed', targetClientDeviceIds: [device.id], targetClientKeys: [device.apiKey],
    } });
  });

  it('drops deleted terminals on a write with unchanged targets but never widens to all terminals', async () => {
    const { app, db } = fixture();
    db.clientDevice.findMany.mockResolvedValue([]);
    const response = await app.inject({ method: 'PUT', url: `/schedules/${scheduleId}`, payload: { name: 'Renamed' } });
    expect(response.statusCode).toBe(200);
    expect(db.signageSchedule.update).toHaveBeenCalledWith({ where: { id: scheduleId }, data: { name: 'Renamed' } });
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

  it('clears both target arrays for all terminals', async () => {
    const { app, db } = fixture();
    const response = await app.inject({ method: 'PUT', url: `/schedules/${scheduleId}`, payload: { targetClientDeviceIds: [] } });
    expect(response.statusCode).toBe(200);
    expect(response.json().schedule).toMatchObject({ targetClientDeviceIds: [], targetClientKeys: [] });
    expect(db.clientDevice.findMany).not.toHaveBeenCalled();
  });
});
