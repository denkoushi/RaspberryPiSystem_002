import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { createTestClientDevice } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

describe('POST /api/kiosk/support', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let clientKey: string;
  let clientId: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    const client = await createTestClientDevice();
    clientKey = client.apiKey;
    clientId = client.id;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should return 401 without x-client-key header', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/kiosk/support',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        message: 'Test message',
        page: '/kiosk'
      }
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.errorCode).toBe('CLIENT_KEY_REQUIRED');
  });

  it('should return 401 with invalid x-client-key', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/kiosk/support',
      headers: {
        'x-client-key': 'invalid-key',
        'Content-Type': 'application/json'
      },
      payload: {
        message: 'Test message',
        page: '/kiosk'
      }
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.errorCode).toBe('CLIENT_KEY_INVALID');
  });

  it('should create support log and return 200', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/kiosk/support',
      headers: {
        'x-client-key': clientKey,
        'Content-Type': 'application/json'
      },
      payload: {
        message: 'Test support message',
        page: '/kiosk/borrow'
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.requestId).toBeDefined();

    // ログが保存されていることを確認
    const logs = await prisma.clientLog.findMany({
      where: {
        clientId,
        message: { contains: '[SUPPORT]' }
      },
      orderBy: { createdAt: 'desc' },
      take: 1
    });

    expect(logs.length).toBe(1);
    expect(logs[0].message).toContain('[SUPPORT]');
    expect(logs[0].message).toContain('Test support message');
    expect(logs[0].level).toBe('INFO');
    
    const context = logs[0].context as { kind?: string; page?: string; userMessage?: string };
    expect(context.kind).toBe('kiosk-support');
    expect(context.page).toBe('/kiosk/borrow');
    expect(context.userMessage).toBe('Test support message');
  });

  it('should enforce rate limit (max 3 requests per minute)', async () => {
    // 最初の3件は成功
    for (let i = 0; i < 3; i++) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/kiosk/support',
        headers: {
          'x-client-key': clientKey,
          'Content-Type': 'application/json'
        },
        payload: {
          message: `Test message ${i}`,
          page: '/kiosk'
        }
      });
      expect(response.statusCode).toBe(200);
    }

    // 4件目はレート制限エラー
    const response = await app.inject({
      method: 'POST',
      url: '/api/kiosk/support',
      headers: {
        'x-client-key': clientKey,
        'Content-Type': 'application/json'
      },
      payload: {
        message: 'Test message 4',
        page: '/kiosk'
      }
    });

    expect(response.statusCode).toBe(429);
    const body = response.json();
    expect(body.errorCode).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('should validate message length (max 1000 chars)', async () => {
    const longMessage = 'a'.repeat(1001);
    const response = await app.inject({
      method: 'POST',
      url: '/api/kiosk/support',
      headers: {
        'x-client-key': clientKey,
        'Content-Type': 'application/json'
      },
      payload: {
        message: longMessage,
        page: '/kiosk'
      }
    });

    expect(response.statusCode).toBe(400);
  });

  it('should validate required fields', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/kiosk/support',
      headers: {
        'x-client-key': clientKey,
        'Content-Type': 'application/json'
      },
      payload: {
        // message が欠けている
        page: '/kiosk'
      }
    });

    expect(response.statusCode).toBe(400);
  });
});

