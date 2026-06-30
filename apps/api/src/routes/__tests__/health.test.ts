import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

const { mockHeapSizeLimit, mockQueryRaw } = vi.hoisted(() => ({
  mockHeapSizeLimit: vi.fn(() => 1024 * 1024 * 1024),
  mockQueryRaw: vi.fn(async () => [{ ok: 1 }]),
}));

vi.mock('../../services/system/event-loop-observability.js', () => ({
  evaluateEventLoopHealth: () => ({ status: 'ok' }),
  snapshotEventLoopObservability: () => ({
    elu: {
      utilization: 0.1,
      activeMs: 100,
      idleMs: 900,
    },
    eventLoopDelayMs: {
      mean: 10,
      max: 20,
      p50: 8,
      p90: 12,
      p99: 16,
    },
  }),
}));

vi.mock('node:v8', () => ({
  getHeapStatistics: () => ({
    heap_size_limit: mockHeapSizeLimit(),
  }),
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: mockQueryRaw,
  },
}));

import { buildServer } from '../../app.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

function authHeader(role: 'ADMIN' | 'MANAGER' | 'VIEWER') {
  const token = jwt.sign(
    { sub: `test-${role.toLowerCase()}`, username: `test-${role.toLowerCase()}`, role },
    process.env.JWT_ACCESS_SECRET!,
  );
  return { authorization: `Bearer ${token}` };
}

describe('GET /api/system/health', () => {
  let closeServer: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (closeServer) {
      await closeServer();
      closeServer = null;
    }
    mockHeapSizeLimit.mockReset();
    mockHeapSizeLimit.mockReturnValue(1024 * 1024 * 1024);
    mockQueryRaw.mockReset();
    mockQueryRaw.mockResolvedValue([{ ok: 1 }]);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('returns a slim public health response', async () => {
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 128 * 1024 * 1024,
      heapTotal: 128 * 1024 * 1024,
      heapUsed: 64 * 1024 * 1024,
      external: 8 * 1024 * 1024,
      arrayBuffers: 1 * 1024 * 1024,
    });

    const app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
    const response = await app.inject({ method: 'GET', url: '/api/system/health' });
    const body = response.json();
    expect(response.statusCode, JSON.stringify(body)).toBe(200);
    expect(body).toEqual({
      status: 'ok',
      timestamp: expect.any(String),
    });
    expect(body).not.toHaveProperty('checks');
    expect(body).not.toHaveProperty('memory');
    expect(body).not.toHaveProperty('eventLoop');
    expect(body).not.toHaveProperty('uptime');
  });

  it('requires ADMIN or MANAGER for detailed health', async () => {
    const app = await buildServer();
    closeServer = async () => {
      await app.close();
    };

    const unauth = await app.inject({ method: 'GET', url: '/api/system/health/detail' });
    expect(unauth.statusCode).toBe(401);

    const viewer = await app.inject({
      method: 'GET',
      url: '/api/system/health/detail',
      headers: authHeader('VIEWER'),
    });
    expect(viewer.statusCode).toBe(403);

    for (const role of ['ADMIN', 'MANAGER'] as const) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/system/health/detail',
        headers: authHeader(role),
      });
      const body = response.json();
      expect(response.statusCode, JSON.stringify(body)).toBe(200);
      expect(body.status).toBe('ok');
      expect(body).toHaveProperty('checks');
      expect(body).toHaveProperty('memory');
      expect(body).toHaveProperty('eventLoop');
      expect(body).toHaveProperty('uptime');
      expect(body.checks).toHaveProperty('database');
      expect(body.checks.database.status).toBe('ok');
      expect(body.checks).toHaveProperty('playwright');
      expect(['ok', 'warning']).toContain(body.checks.playwright.status);
    }
  });

  it('returns detailed health information for an admin', async () => {
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 128 * 1024 * 1024,
      heapTotal: 128 * 1024 * 1024,
      heapUsed: 64 * 1024 * 1024,
      external: 8 * 1024 * 1024,
      arrayBuffers: 1 * 1024 * 1024,
    });

    const app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
    const response = await app.inject({
      method: 'GET',
      url: '/api/system/health/detail',
      headers: authHeader('ADMIN'),
    });
    const body = response.json();
    expect(response.statusCode, JSON.stringify(body)).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.checks).toHaveProperty('database');
    expect(body.checks.database.status).toBe('ok');
    expect(body.checks).toHaveProperty('playwright');
    expect(['ok', 'warning']).toContain(body.checks.playwright.status);
  });

  it('keeps health ok when allocated heap is high but process limit has room', async () => {
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 208 * 1024 * 1024,
      heapTotal: 111 * 1024 * 1024,
      heapUsed: 106 * 1024 * 1024,
      external: 3 * 1024 * 1024,
      arrayBuffers: 1 * 1024 * 1024,
    });

    const app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
    const response = await app.inject({
      method: 'GET',
      url: '/api/system/health/detail',
      headers: authHeader('ADMIN'),
    });
    const body = response.json();
    expect(response.statusCode, JSON.stringify(body)).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.checks.memory.status).toBe('ok');
    expect(body.checks.memory.message).toContain('Allocated heap usage warning');
  });

  it('returns degraded when heap usage is close to the process limit', async () => {
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 1000 * 1024 * 1024,
      heapTotal: 990 * 1024 * 1024,
      heapUsed: 980 * 1024 * 1024,
      external: 8 * 1024 * 1024,
      arrayBuffers: 1 * 1024 * 1024,
    });

    const app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
    const response = await app.inject({ method: 'GET', url: '/api/system/health' });
    const body = response.json();
    expect(response.statusCode, JSON.stringify(body)).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body).not.toHaveProperty('checks');

    const detail = await app.inject({
      method: 'GET',
      url: '/api/system/health/detail',
      headers: authHeader('ADMIN'),
    });
    const detailBody = detail.json();
    expect(detail.statusCode, JSON.stringify(detailBody)).toBe(503);
    expect(detailBody.checks.memory.status).toBe('error');
    expect(detailBody.checks.memory.message).toContain('High heap usage');
  });

  it('returns degraded public health when database check fails without exposing details', async () => {
    mockQueryRaw.mockRejectedValueOnce(new Error('database unavailable'));

    const app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
    const response = await app.inject({ method: 'GET', url: '/api/system/health' });
    const body = response.json();
    expect(response.statusCode, JSON.stringify(body)).toBe(503);
    expect(body).toEqual({
      status: 'degraded',
      timestamp: expect.any(String),
    });
    expect(body).not.toHaveProperty('checks');
  });
});
