import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import {
  createTestUser,
  createAuthHeader,
  createTestClientDevice,
  measureInjectResponse,
} from './helpers.js';

const PERF_RESPONSE_TIME_THRESHOLD_MS = Number(
  process.env.PERF_RESPONSE_TIME_THRESHOLD_MS ?? '1500'
);

const isDatabaseUnavailable = (statusCode: number, body: unknown): boolean => {
  if (statusCode === 503) return true;
  if (!body || typeof body !== 'object') return false;
  const message = 'message' in body && typeof body.message === 'string' ? body.message : '';
  return statusCode === 500 && (message.includes('database') || message.includes('Prisma'));
};

describe('Performance Tests (NFR-001)', () => {
  let app: FastifyInstance;
  let authHeaders: Record<string, string>;
  let loginUsername = '';
  let loginPassword = '';
  let kioskClientHeaders: Record<string, string>;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const { user, token, password } = await createTestUser('ADMIN');
    authHeaders = createAuthHeader(token);
    loginUsername = user.username;
    loginPassword = password;

    const client = await createTestClientDevice('perf-client-key');
    kioskClientHeaders = { 'x-client-key': client.apiKey };
  });

  afterAll(async () => {
    await app.close();
  });

  describe('API Response Time', () => {
    it('should respond to /api/system/health within threshold', async () => {
      const { response, responseTimeMs } = await measureInjectResponse<Awaited<ReturnType<FastifyInstance['inject']>>>({
        app,
        request: {
          method: 'GET',
          url: '/api/system/health',
        },
      });
      const body = response.json() as Record<string, unknown>;

      if (isDatabaseUnavailable(response.statusCode, body)) {
        console.log('Skipping test: Database not available');
        return;
      }

      expect(response.statusCode).toBe(200);
      expect(responseTimeMs).toBeLessThan(PERF_RESPONSE_TIME_THRESHOLD_MS);
    });

    it('should respond to /api/auth/login within threshold', async () => {
      const { response, responseTimeMs } = await measureInjectResponse<Awaited<ReturnType<FastifyInstance['inject']>>>({
        app,
        request: {
          method: 'POST',
          url: '/api/auth/login',
          payload: {
            username: loginUsername,
            password: loginPassword,
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(responseTimeMs).toBeLessThan(PERF_RESPONSE_TIME_THRESHOLD_MS);
    });

    it('should respond to /api/backup/config within threshold', async () => {
      const { response, responseTimeMs } = await measureInjectResponse<Awaited<ReturnType<FastifyInstance['inject']>>>({
        app,
        request: {
          method: 'GET',
          url: '/api/backup/config',
          headers: authHeaders,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(responseTimeMs).toBeLessThan(PERF_RESPONSE_TIME_THRESHOLD_MS);
    });

    it('should respond to /api/imports/history within threshold', async () => {
      const { response, responseTimeMs } = await measureInjectResponse<Awaited<ReturnType<FastifyInstance['inject']>>>({
        app,
        request: {
          method: 'GET',
          url: '/api/imports/history',
          headers: authHeaders,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(responseTimeMs).toBeLessThan(PERF_RESPONSE_TIME_THRESHOLD_MS);
    });

    it('should respond to /api/kiosk/production-schedule/history-progress within threshold', async () => {
      const { response, responseTimeMs } = await measureInjectResponse<Awaited<ReturnType<FastifyInstance['inject']>>>({
        app,
        request: {
          method: 'GET',
          url: '/api/kiosk/production-schedule/history-progress',
          headers: kioskClientHeaders,
        },
      });

      if (response.statusCode === 404) {
        console.log('Skipping test: kiosk production schedule route unavailable in current setup');
        return;
      }

      expect(response.statusCode).toBe(200);
      expect(responseTimeMs).toBeLessThan(PERF_RESPONSE_TIME_THRESHOLD_MS);
    });

    it('should respond to /api/system/metrics within threshold', async () => {
      const { response, responseTimeMs } = await measureInjectResponse<Awaited<ReturnType<FastifyInstance['inject']>>>({
        app,
        request: {
          method: 'GET',
          url: '/api/system/metrics',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body.length).toBeGreaterThan(0);
      expect(responseTimeMs).toBeLessThan(PERF_RESPONSE_TIME_THRESHOLD_MS);
    });
  });
});

