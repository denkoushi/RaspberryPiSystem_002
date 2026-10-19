import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@prisma/client';

import { signAccessToken } from '../../lib/auth.js';
import type { SignageService } from '../../services/signage/index.js';
import { registerScheduleRoutes } from './schedules.js';

const publicSchedule = {
  id: 'schedule-public',
  name: '端末別予定',
  contentType: 'TOOLS',
  pdfId: null,
  layoutConfig: { layout: 'FULL', slots: [{ kind: 'loans' }] },
  dayOfWeek: [1, 3, 5],
  startTime: '09:00',
  endTime: '18:00',
  priority: 2,
  enabled: true,
};
const internalSchedule = {
  ...publicSchedule,
  targetClientKeys: ['synthetic-schedule-credential'],
  apiKey: 'synthetic-future-credential',
};

const service = {
  getSchedules: vi.fn(),
  listSchedulesForManagement: vi.fn(),
};

function authHeader(role: User['role']) {
  const token = signAccessToken({
    id: '11111111-1111-4111-8111-111111111111',
    username: 'schedule-test-user',
    passwordHash: 'unused-test-hash',
    role,
    status: 'ACTIVE',
    mfaEnabled: false,
    totpSecret: null,
    mfaBackupCodes: [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
  return { authorization: `Bearer ${token}` };
}

describe('signage schedule response boundaries', () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    service.getSchedules.mockResolvedValue([internalSchedule]);
    service.listSchedulesForManagement.mockResolvedValue([internalSchedule]);
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  function buildApp() {
    const app = Fastify();
    registerScheduleRoutes(app, service as unknown as SignageService);
    apps.push(app);
    return app;
  }

  it('returns public schedule fields anonymously without credentials or changing the internal record', async () => {
    const response = await buildApp().inject({ method: 'GET', url: '/schedules' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ schedules: [publicSchedule] });
    expect(response.json().schedules[0]).not.toHaveProperty('targetClientKeys');
    expect(response.json().schedules[0]).not.toHaveProperty('apiKey');
    expect(response.body).not.toContain(internalSchedule.targetClientKeys[0]);
    expect(response.body).not.toContain(internalSchedule.apiKey);
    expect(internalSchedule.targetClientKeys).toEqual(['synthetic-schedule-credential']);
    expect(service.listSchedulesForManagement).not.toHaveBeenCalled();
  });

  it('preserves an empty public schedule list', async () => {
    service.getSchedules.mockResolvedValue([]);
    const response = await buildApp().inject({ method: 'GET', url: '/schedules' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ schedules: [] });
  });

  it.each(['ADMIN', 'MANAGER'] as const)('preserves target assignments in the authenticated %s management response', async (role) => {
    const response = await buildApp().inject({
      method: 'GET',
      url: '/schedules/management',
      headers: authHeader(role),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ schedules: [internalSchedule] });
    expect(service.getSchedules).not.toHaveBeenCalled();
  });

  it('keeps the management list unavailable to anonymous and VIEWER callers', async () => {
    const app = buildApp();
    const anonymous = await app.inject({ method: 'GET', url: '/schedules/management' });
    const viewer = await app.inject({
      method: 'GET',
      url: '/schedules/management',
      headers: authHeader('VIEWER'),
    });

    expect(anonymous.statusCode).toBe(401);
    expect(viewer.statusCode).toBe(403);
    expect(service.listSchedulesForManagement).not.toHaveBeenCalled();
  });
});
