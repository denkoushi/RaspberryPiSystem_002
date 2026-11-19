import type { User } from '@prisma/client';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { signAccessToken } from '../../lib/auth.js';
import { registerErrorHandler } from '../../plugins/error-handler.js';
import { getDScheduleMinutesGmailIngestionService } from '../../services/production-schedule/d-schedule-minutes/d-schedule-minutes-gmail-ingestion.service.js';
import { registerImportScheduleRoutes } from '../imports/schedule.js';

const { findSession, findRuns } = vi.hoisted(() => ({ findSession: vi.fn(), findRuns: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    authSession: { findUnique: findSession },
    productionScheduleDScheduleMinutesImportRun: { findMany: findRuns },
  },
}));

const path = '/api/imports/d-schedule-minutes/runs';
const id = 'a1a39d50-7152-4cd5-83a4-26d5c9c63cd2';
let app: FastifyInstance;
let reimport: ReturnType<typeof mockReimport>;

function mockReimport() {
  return vi.spyOn(getDScheduleMinutesGmailIngestionService(), 'reimportOriginal').mockResolvedValue({
    id: 'new-run', status: 'SUCCESS', warningCounts: { UNKNOWN_STAR: 2 }, autoRegistrationSkipped: undefined,
  });
}

function headers(role: User['role']) {
  const user = { id: 'user', username: 'test-user', role, status: 'ACTIVE', mfaEnabled: true } as User;
  findSession.mockResolvedValue({ user, userId: user.id, revokedAt: null, expiresAt: new Date(Date.now() + 60_000) });
  return { authorization: `Bearer ${signAccessToken(user, 'session')}` };
}

beforeEach(async () => {
  vi.clearAllMocks();
  reimport = mockReimport();
  app = Fastify();
  registerErrorHandler(app);
  await app.register(registerImportScheduleRoutes, { prefix: '/api' });
});

afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});

describe('schedule minutes import history routes', () => {
  it.each(['VIEWER', 'MANAGER'] as const)('rejects both routes for %s', async (role) => {
    const auth = headers(role);
    expect((await app.inject({ method: 'GET', url: path, headers: auth })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `${path}/${id}/reimport`, headers: auth })).statusCode).toBe(403);
    expect(findRuns).not.toHaveBeenCalled();
    expect(reimport).not.toHaveBeenCalled();
  });

  it('lists up to 30 runs, newest first, with file availability and the selected metadata', async () => {
    const date = new Date('2026-11-20T00:00Z');
    const run = { id, kind: 'D_COMPANY', filename: 'minutes.xlsx', meetingDate: date, receivedAt: date, createdAt: date, status: 'SUCCESS' };
    findRuns.mockResolvedValue([{ ...run, originalFilePath: 'private/storage/key' }, { ...run, id: 'older', originalFilePath: null }]);
    const response = await app.inject({ method: 'GET', url: path, headers: headers('ADMIN') });
    expect(response.statusCode).toBe(200);
    expect(findRuns).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 30 }));
    const serializedDates = { meetingDate: date.toISOString(), receivedAt: date.toISOString(), createdAt: date.toISOString() };
    expect(response.json()).toEqual({ runs: [
      { ...run, ...serializedDates, hasOriginalFile: true },
      { ...run, ...serializedDates, id: 'older', hasOriginalFile: false },
    ] });
  });

  it('reimports the selected run for an administrator and rejects malformed ids', async () => {
    const auth = headers('ADMIN');
    const invalid = await app.inject({ method: 'POST', url: `${path}/invalid/reimport`, headers: auth });
    expect(invalid.statusCode).toBe(400);
    const response = await app.inject({ method: 'POST', url: `${path}/${id}/reimport`, headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: 'new-run', status: 'SUCCESS', warningCounts: { UNKNOWN_STAR: 2 } });
    expect(reimport).toHaveBeenCalledExactlyOnceWith(id);
  });
});
