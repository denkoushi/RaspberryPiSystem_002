import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import { createAuthHeader, createTestUser } from './helpers.js';
import { prisma } from '../../lib/prisma.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

describe('Visualizations API', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;
  let testUserId: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };

    const { user, token } = await createTestUser('ADMIN');
    testUserId = user.id;
    adminToken = token;
  });

  afterAll(async () => {
    await prisma.visualizationDashboard.deleteMany({});
    await prisma.user.deleteMany({ where: { id: testUserId } });

    if (closeServer) {
      await closeServer();
    }
  });

  beforeEach(async () => {
    await prisma.visualizationDashboard.deleteMany({});
  });

  it('should create a visualization dashboard', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/visualizations',
      headers: {
        ...createAuthHeader(adminToken),
      },
      payload: {
        name: 'Test Visualization',
        description: 'Test Description',
        dataSourceType: 'measuring_instruments',
        rendererType: 'kpi_cards',
        dataSourceConfig: { metric: 'return_rate', periodDays: 7 },
        rendererConfig: {},
        enabled: true,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toHaveProperty('dashboard');
    expect(body.dashboard.name).toBe('Test Visualization');
  });

  it('should reject uninspected_machines without csvDashboardId', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/visualizations',
      headers: {
        ...createAuthHeader(adminToken),
      },
      payload: {
        name: 'Uninspected',
        dataSourceType: 'uninspected_machines',
        rendererType: 'uninspected_machines',
        dataSourceConfig: {},
        rendererConfig: {},
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('should list visualization dashboards', async () => {
    await prisma.visualizationDashboard.create({
      data: {
        name: 'Dashboard 1',
        dataSourceType: 'measuring_instruments',
        rendererType: 'bar_chart',
        dataSourceConfig: { metric: 'usage_top', periodDays: 7, topN: 5 },
        rendererConfig: {},
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/visualizations',
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

  it('should get a visualization dashboard by ID', async () => {
    const dashboard = await prisma.visualizationDashboard.create({
      data: {
        name: 'Dashboard 1',
        dataSourceType: 'measuring_instruments',
        rendererType: 'bar_chart',
        dataSourceConfig: { metric: 'usage_top', periodDays: 7, topN: 5 },
        rendererConfig: {},
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/visualizations/${dashboard.id}`,
      headers: {
        ...createAuthHeader(adminToken),
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('dashboard');
    expect(body.dashboard.id).toBe(dashboard.id);
  });

  it('should update a visualization dashboard', async () => {
    const dashboard = await prisma.visualizationDashboard.create({
      data: {
        name: 'Dashboard 1',
        dataSourceType: 'measuring_instruments',
        rendererType: 'bar_chart',
        dataSourceConfig: { metric: 'usage_top', periodDays: 7, topN: 5 },
        rendererConfig: {},
      },
    });

    const response = await app.inject({
      method: 'PUT',
      url: `/api/visualizations/${dashboard.id}`,
      headers: {
        ...createAuthHeader(adminToken),
      },
      payload: {
        name: 'Dashboard 1 Updated',
        enabled: false,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.dashboard.name).toBe('Dashboard 1 Updated');
    expect(body.dashboard.enabled).toBe(false);
  });

  it('should delete a visualization dashboard', async () => {
    const dashboard = await prisma.visualizationDashboard.create({
      data: {
        name: 'Dashboard 1',
        dataSourceType: 'measuring_instruments',
        rendererType: 'bar_chart',
        dataSourceConfig: { metric: 'usage_top', periodDays: 7, topN: 5 },
        rendererConfig: {},
      },
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/visualizations/${dashboard.id}`,
      headers: {
        ...createAuthHeader(adminToken),
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
  });
});
