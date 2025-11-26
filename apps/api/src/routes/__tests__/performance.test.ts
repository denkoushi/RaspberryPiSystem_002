import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../app.js';
import type { FastifyInstance } from 'fastify';

describe('Performance Tests (NFR-001)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('API Response Time', () => {
    it('should respond to /api/system/health within 1 second', async () => {
      const startTime = Date.now();
      const response = await app.inject({
        method: 'GET',
        url: '/api/system/health',
      });
      const endTime = Date.now();
      const responseTime = endTime - startTime;

      expect(response.statusCode).toBe(200);
      expect(responseTime).toBeLessThan(1000); // 1秒以内
    });

    it('should respond to /api/tools/employees within 1 second', async () => {
      // 認証トークンを取得
      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          username: 'admin',
          password: 'admin1234',
        },
      });

      if (loginResponse.statusCode !== 200) {
        // テスト用のadminユーザーが存在しない場合はスキップ
        return;
      }

      const { accessToken } = loginResponse.json() as { accessToken: string };

      const startTime = Date.now();
      const response = await app.inject({
        method: 'GET',
        url: '/api/tools/employees',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const endTime = Date.now();
      const responseTime = endTime - startTime;

      expect(response.statusCode).toBe(200);
      expect(responseTime).toBeLessThan(1000); // 1秒以内
    });

    it('should respond to /api/tools/items within 1 second', async () => {
      // 認証トークンを取得
      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          username: 'admin',
          password: 'admin1234',
        },
      });

      if (loginResponse.statusCode !== 200) {
        return;
      }

      const { accessToken } = loginResponse.json() as { accessToken: string };

      const startTime = Date.now();
      const response = await app.inject({
        method: 'GET',
        url: '/api/tools/items',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const endTime = Date.now();
      const responseTime = endTime - startTime;

      expect(response.statusCode).toBe(200);
      expect(responseTime).toBeLessThan(1000); // 1秒以内
    });

    it('should respond to /api/system/metrics within 1 second', async () => {
      const startTime = Date.now();
      const response = await app.inject({
        method: 'GET',
        url: '/api/system/metrics',
      });
      const endTime = Date.now();
      const responseTime = endTime - startTime;

      expect(response.statusCode).toBe(200);
      expect(responseTime).toBeLessThan(1000); // 1秒以内
    });
  });
});

