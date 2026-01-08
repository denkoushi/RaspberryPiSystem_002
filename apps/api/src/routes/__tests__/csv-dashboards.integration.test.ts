import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import { createAuthHeader, createTestUser } from './helpers.js';
import { prisma } from '../../lib/prisma.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

describe('CSV Dashboards API', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;
  let testUserId: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };

    // テストユーザーを作成
    const { user, token } = await createTestUser();
    testUserId = user.id;
    adminToken = token;
  });

  afterAll(async () => {
    // テストデータをクリーンアップ
    await prisma.csvDashboardRow.deleteMany({});
    await prisma.csvDashboardIngestRun.deleteMany({});
    await prisma.csvDashboard.deleteMany({});
    await prisma.user.deleteMany({ where: { id: testUserId } });

    if (closeServer) {
      await closeServer();
    }
  });

  beforeEach(async () => {
    // 各テスト前にCSVダッシュボード関連データをクリーンアップ
    await prisma.csvDashboardRow.deleteMany({});
    await prisma.csvDashboardIngestRun.deleteMany({});
    await prisma.csvDashboard.deleteMany({});
  });

  describe('POST /api/csv-dashboards', () => {
    it('should create a CSV dashboard', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/csv-dashboards',
        headers: {
          ...createAuthHeader(adminToken),
        },
        payload: {
          name: 'Test Dashboard',
          description: 'Test Description',
          columnDefinitions: [
            {
              internalName: 'date',
              displayName: '日付',
              csvHeaderCandidates: ['日付', 'Date'],
              dataType: 'date',
              order: 0,
            },
            {
              internalName: 'value',
              displayName: '値',
              csvHeaderCandidates: ['値', 'Value'],
              dataType: 'number',
              order: 1,
            },
          ],
          dateColumnName: 'date',
          displayPeriodDays: 1,
          templateType: 'TABLE',
          templateConfig: {
            rowsPerPage: 10,
            fontSize: 14,
            displayColumns: ['date', 'value'],
          },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body).toHaveProperty('id');
      expect(body.name).toBe('Test Dashboard');
      expect(body.templateType).toBe('TABLE');
    });

    it('should reject invalid column definitions', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/csv-dashboards',
        headers: {
          ...createAuthHeader(adminToken),
        },
        payload: {
          name: 'Test Dashboard',
          columnDefinitions: [], // 空の列定義
          templateType: 'TABLE',
          templateConfig: {
            rowsPerPage: 10,
            fontSize: 14,
            displayColumns: ['date'],
          },
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/csv-dashboards', () => {
    it('should list CSV dashboards', async () => {
      // テストデータを作成
      await prisma.csvDashboard.create({
        data: {
          name: 'Dashboard 1',
          columnDefinitions: [
            {
              internalName: 'date',
              displayName: '日付',
              dataType: 'date',
              order: 0,
            },
          ],
          templateType: 'TABLE',
          templateConfig: {
            rowsPerPage: 10,
            fontSize: 14,
            displayColumns: ['date'],
          },
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/csv-dashboards',
        headers: {
          ...createAuthHeader(adminToken),
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('dashboards');
      expect(Array.isArray(body.dashboards)).toBe(true);
      expect(body.dashboards.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/csv-dashboards/:id', () => {
    it('should get a CSV dashboard by ID', async () => {
      const dashboard = await prisma.csvDashboard.create({
        data: {
          name: 'Dashboard 1',
          columnDefinitions: [
            {
              internalName: 'date',
              displayName: '日付',
              dataType: 'date',
              order: 0,
            },
          ],
          templateType: 'TABLE',
          templateConfig: {
            rowsPerPage: 10,
            fontSize: 14,
            displayColumns: ['date'],
          },
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/csv-dashboards/${dashboard.id}`,
        headers: {
          ...createAuthHeader(adminToken),
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('dashboard');
      expect(body.dashboard.id).toBe(dashboard.id);
      expect(body.dashboard.name).toBe('Dashboard 1');
    });

    it('should return 404 for non-existent dashboard', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/csv-dashboards/00000000-0000-0000-0000-000000000000',
        headers: {
          ...createAuthHeader(adminToken),
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('PUT /api/csv-dashboards/:id', () => {
    it('should update a CSV dashboard', async () => {
      const dashboard = await prisma.csvDashboard.create({
        data: {
          name: 'Dashboard 1',
          columnDefinitions: [
            {
              internalName: 'date',
              displayName: '日付',
              dataType: 'date',
              order: 0,
            },
          ],
          templateType: 'TABLE',
          templateConfig: {
            rowsPerPage: 10,
            fontSize: 14,
            displayColumns: ['date'],
          },
        },
      });

      const response = await app.inject({
        method: 'PUT',
        url: `/api/csv-dashboards/${dashboard.id}`,
        headers: {
          ...createAuthHeader(adminToken),
        },
        payload: {
          name: 'Updated Dashboard',
          columnDefinitions: [
            {
              internalName: 'date',
              displayName: '日付',
              csvHeaderCandidates: ['日付', 'Date'],
              dataType: 'date',
              order: 0,
            },
          ],
          templateType: 'TABLE',
          templateConfig: {
            rowsPerPage: 10,
            fontSize: 14,
            displayColumns: ['date'],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('dashboard');
      expect(body.dashboard.name).toBe('Updated Dashboard');
    });
  });

  describe('DELETE /api/csv-dashboards/:id', () => {
    it('should delete a CSV dashboard', async () => {
      const dashboard = await prisma.csvDashboard.create({
        data: {
          name: 'Dashboard 1',
          columnDefinitions: [
            {
              internalName: 'date',
              displayName: '日付',
              dataType: 'date',
              order: 0,
            },
          ],
          templateType: 'TABLE',
          templateConfig: {
            rowsPerPage: 10,
            fontSize: 14,
            displayColumns: ['date'],
          },
        },
      });

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/csv-dashboards/${dashboard.id}`,
        headers: {
          ...createAuthHeader(adminToken),
        },
      });

      expect(response.statusCode).toBe(200);

      // 削除されたことを確認
      const deleted = await prisma.csvDashboard.findUnique({
        where: { id: dashboard.id },
      });
      expect(deleted).toBeNull();
    });
  });

  describe('POST /api/csv-dashboards/:id/preview-parse', () => {
    it('should parse CSV content and return preview', async () => {
      const dashboard = await prisma.csvDashboard.create({
        data: {
          name: 'Dashboard 1',
          columnDefinitions: [
            {
              internalName: 'date',
              displayName: '日付',
              dataType: 'date',
              order: 0,
            },
            {
              internalName: 'value',
              displayName: '値',
              dataType: 'number',
              order: 1,
            },
          ],
          templateType: 'TABLE',
          templateConfig: {
            rowsPerPage: 10,
            fontSize: 14,
            displayColumns: ['date', 'value'],
          },
        },
      });

      const csvContent = 'date,value\n2026/1/8 8:13,100\n2026/1/8 9:00,200';

      const response = await app.inject({
        method: 'POST',
        url: `/api/csv-dashboards/${dashboard.id}/preview-parse`,
        headers: {
          ...createAuthHeader(adminToken),
          'content-type': 'application/json',
        },
        payload: {
          csvContent,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('preview');
      expect(body.preview).toHaveProperty('headers');
      expect(body.preview).toHaveProperty('sampleRows');
      expect(body.preview).toHaveProperty('detectedTypes');
      expect(body.preview.headers).toContain('date');
      expect(body.preview.headers).toContain('value');
    });
  });
});
