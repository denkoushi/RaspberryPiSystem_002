import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../../lib/prisma.js';
import {
  SignageWebCaptureService,
  extractWebCaptureIds,
  isWebCaptureDue,
  type SignageWebCaptureServiceDeps,
} from '../signage-web-capture.service.js';

vi.mock('../../../../lib/prisma.js', () => ({
  prisma: {
    signageWebCapture: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    signageSchedule: { findMany: vi.fn() },
    signageEmergency: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

const row = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  name: '自主検査KPI',
  path: '/admin/self-inspection/kpi',
  viewportWidth: 1920,
  viewportHeight: 1080,
  waitMode: 'network_idle',
  waitSeconds: 3,
  hideSelectors: ['header'],
  clipSelector: null,
  refreshIntervalSeconds: 300,
  enabled: true,
  lastCapturedAt: null,
  lastStatus: 'never',
  lastError: null,
  lastDurationMs: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  ...overrides,
});

const webPageLayout = (id: string) => ({ layout: 'FULL', slots: [{ position: 'FULL', kind: 'web_page', config: { webCaptureId: id } }] });

function buildService(overrides: Partial<SignageWebCaptureServiceDeps> = {}) {
  const capturer = { capture: vi.fn().mockResolvedValue({ jpeg: Buffer.from('jpeg'), regions: [], durationMs: 1200, autoHiddenSelectors: [], pageTitle: null }) };
  const storage = { save: vi.fn().mockResolvedValue(undefined), read: vi.fn(), remove: vi.fn().mockResolvedValue(undefined) };
  const deps: SignageWebCaptureServiceDeps = {
    capturer,
    storage,
    getBaseUrl: () => 'http://web:8081',
    getCaptureUsername: () => 'signage-capture',
    findUserByUsername: vi.fn().mockResolvedValue({ id: 'u1', username: 'signage-capture', role: 'MANAGER', status: 'ACTIVE' }),
    signToken: vi.fn().mockReturnValue('token'),
    ...overrides,
  };
  return { service: new SignageWebCaptureService(deps), capturer, storage, deps };
}

describe('extractWebCaptureIds', () => {
  it('returns ids of web_page slots only', () => {
    expect(extractWebCaptureIds(webPageLayout(ID))).toEqual([ID]);
    expect(extractWebCaptureIds({ layout: 'FULL', slots: [{ position: 'FULL', kind: 'loans', config: {} }] })).toEqual([]);
    expect(extractWebCaptureIds(null)).toEqual([]);
    expect(extractWebCaptureIds({ slots: 'broken' })).toEqual([]);
  });
});

describe('isWebCaptureDue', () => {
  const now = new Date('2026-10-01T03:00:00Z');
  const referenced = new Set([ID]);

  it('is due when never captured or when the interval has passed', () => {
    expect(isWebCaptureDue(row(), referenced, now)).toBe(true);
    expect(isWebCaptureDue(row({ lastCapturedAt: new Date('2026-10-01T02:55:00Z') }), referenced, now)).toBe(true);
  });

  it('is not due inside the interval, when disabled, or when no schedule uses it', () => {
    expect(isWebCaptureDue(row({ lastCapturedAt: new Date('2026-10-01T02:56:00Z') }), referenced, now)).toBe(false);
    expect(isWebCaptureDue(row({ enabled: false }), referenced, now)).toBe(false);
    expect(isWebCaptureDue(row(), new Set([OTHER_ID]), now)).toBe(false);
  });
});

describe('SignageWebCaptureService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.signageWebCapture.findUnique).mockResolvedValue(row() as never);
    vi.mocked(prisma.signageWebCapture.update).mockImplementation((async ({ data }: { data: object }) => ({ ...row(), ...data })) as never);
    vi.mocked(prisma.signageSchedule.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.signageEmergency.findMany).mockResolvedValue([] as never);
  });

  it('rejects a path outside the admin web on create', async () => {
    const { service } = buildService();
    await expect(
      service.create({ ...row(), name: 'x', path: 'https://evil.example/', waitMode: 'network_idle' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'SIGNAGE_WEB_CAPTURE_INVALID_PATH' });
    expect(prisma.signageWebCapture.create).not.toHaveBeenCalled();
  });

  it('captures with a MANAGER token and stores the image and result', async () => {
    const { service, capturer, storage } = buildService();
    const updated = await service.captureAndStore(ID);
    expect(capturer.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://web:8081/admin/self-inspection/kpi',
        hideSelectors: ['header'],
        auth: { token: 'token', user: { id: 'u1', username: 'signage-capture', role: 'MANAGER' } },
      }),
    );
    expect(storage.save).toHaveBeenCalledWith(ID, Buffer.from('jpeg'));
    expect(updated).toMatchObject({ lastStatus: 'success', lastError: null, lastDurationMs: 1200 });
  });

  it.each([
    ['ADMIN', 'ACTIVE'],
    ['VIEWER', 'ACTIVE'],
    ['MANAGER', 'DISABLED'],
  ])('records a failure and does not capture when the capture user is %s/%s', async (role, status) => {
    const { service, capturer, storage } = buildService({
      findUserByUsername: vi.fn().mockResolvedValue({ id: 'u1', username: 'signage-capture', role, status }),
    });
    const updated = await service.captureAndStore(ID);
    expect(capturer.capture).not.toHaveBeenCalled();
    expect(storage.save).not.toHaveBeenCalled();
    expect(updated.lastStatus).toBe('failed');
  });

  it('records a failure when the capture user is not configured', async () => {
    const { service, capturer } = buildService({ getCaptureUsername: () => undefined });
    const updated = await service.captureAndStore(ID);
    expect(capturer.capture).not.toHaveBeenCalled();
    expect(updated).toMatchObject({ lastStatus: 'failed' });
    expect(updated.lastError).toContain('SIGNAGE_WEB_CAPTURE_USERNAME');
  });

  it('runs captures one at a time', async () => {
    let active = 0;
    let maxActive = 0;
    const capturer = {
      capture: vi.fn().mockImplementation(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { jpeg: Buffer.from('x'), regions: [], durationMs: 5, autoHiddenSelectors: [], pageTitle: null };
      }),
    };
    const { service } = buildService({ capturer });
    await Promise.all([service.captureAndStore(ID), service.captureAndStore(ID), service.captureOnce(row() as never)]);
    expect(capturer.capture).toHaveBeenCalledTimes(3);
    expect(maxActive).toBe(1);
  });

  it('runDueCaptures only captures content used by an enabled schedule and past its interval', async () => {
    const now = new Date('2026-10-01T03:00:00Z');
    vi.mocked(prisma.signageSchedule.findMany).mockResolvedValue([
      { id: 's1', name: '午後', layoutConfig: webPageLayout(ID) },
      { id: 's2', name: '朝', layoutConfig: webPageLayout(OTHER_ID) },
    ] as never);
    vi.mocked(prisma.signageWebCapture.findMany).mockResolvedValue([
      row({ lastCapturedAt: new Date('2026-10-01T02:50:00Z') }),
      row({ id: OTHER_ID, lastCapturedAt: new Date('2026-10-01T02:59:00Z') }),
    ] as never);
    const { service, capturer } = buildService();
    await expect(service.runDueCaptures(now)).resolves.toBe(1);
    expect(prisma.signageSchedule.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { enabled: true } }));
    expect(capturer.capture).toHaveBeenCalledTimes(1);
  });

  it('runDueCaptures does nothing when capture is not configured', async () => {
    const { service } = buildService({ getBaseUrl: () => undefined });
    await expect(service.runDueCaptures()).resolves.toBe(0);
    expect(prisma.signageSchedule.findMany).not.toHaveBeenCalled();
  });

  it('refuses to delete content that a schedule still uses', async () => {
    vi.mocked(prisma.signageSchedule.findMany).mockResolvedValue([
      { id: 's1', name: '午後のKPI', layoutConfig: webPageLayout(ID) },
    ] as never);
    const { service, storage } = buildService();
    await expect(service.delete(ID)).rejects.toMatchObject({ statusCode: 409, code: 'SIGNAGE_WEB_CAPTURE_IN_USE' });
    expect(prisma.signageWebCapture.delete).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('resets lastCapturedAt when capture settings change so the next run re-captures', async () => {
    const { service } = buildService();
    await service.update(ID, { hideSelectors: ['header', 'aside'] });
    expect(prisma.signageWebCapture.update).toHaveBeenCalledWith({
      where: { id: ID },
      data: { hideSelectors: ['header', 'aside'], lastCapturedAt: null },
    });
    await service.update(ID, { name: '新しい名前' });
    expect(prisma.signageWebCapture.update).toHaveBeenLastCalledWith({ where: { id: ID }, data: { name: '新しい名前' } });
  });
});
