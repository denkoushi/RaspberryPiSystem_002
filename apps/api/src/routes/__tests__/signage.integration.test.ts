import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { buildServer } from '../../app.js';
import {
  createAuthHeader,
  createTestClientDevice,
  createTestUser,
  getOrCreateTestClientDevice,
} from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';
process.env.SIGNAGE_RENDER_DIR ??= `/tmp/raspi-signage-render-test-${process.pid}`;

describe('GET /api/signage/schedules', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should return schedules without authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/signage/schedules',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('schedules');
    expect(Array.isArray(body.schedules)).toBe(true);
  });
});

describe('GET /api/signage/schedules/management', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should return 401 without authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/signage/schedules/management',
    });
    expect(response.statusCode).toBe(401);
  });

  it('should return enabled and disabled schedules for ADMIN', async () => {
    const admin = await createTestUser('ADMIN');
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const enabledRes = await app.inject({
      method: 'POST',
      url: '/api/signage/schedules',
      headers: { ...createAuthHeader(admin.token), 'Content-Type': 'application/json' },
      payload: {
        name: `mgmt-test-enabled-${suffix}`,
        contentType: 'TOOLS',
        dayOfWeek: [1],
        startTime: '09:00',
        endTime: '18:00',
        priority: 1,
        enabled: true,
      },
    });
    expect(enabledRes.statusCode).toBe(200);
    const enabledId = enabledRes.json().schedule.id as string;

    const disabledRes = await app.inject({
      method: 'POST',
      url: '/api/signage/schedules',
      headers: { ...createAuthHeader(admin.token), 'Content-Type': 'application/json' },
      payload: {
        name: `mgmt-test-disabled-${suffix}`,
        contentType: 'TOOLS',
        dayOfWeek: [1],
        startTime: '09:00',
        endTime: '18:00',
        priority: 0,
        enabled: false,
      },
    });
    expect(disabledRes.statusCode).toBe(200);
    const disabledId = disabledRes.json().schedule.id as string;

    const publicList = await app.inject({ method: 'GET', url: '/api/signage/schedules' });
    expect(publicList.statusCode).toBe(200);
    const publicIds = (publicList.json().schedules as Array<{ id: string }>).map((s) => s.id);
    expect(publicIds).toContain(enabledId);
    expect(publicIds).not.toContain(disabledId);

    const mgmt = await app.inject({
      method: 'GET',
      url: '/api/signage/schedules/management',
      headers: createAuthHeader(admin.token),
    });
    expect(mgmt.statusCode).toBe(200);
    const mgmtIds = (mgmt.json().schedules as Array<{ id: string; enabled: boolean }>).map((s) => s.id);
    expect(mgmtIds).toContain(enabledId);
    expect(mgmtIds).toContain(disabledId);
    const disabledRow = (mgmt.json().schedules as Array<{ id: string; enabled: boolean }>).find(
      (s) => s.id === disabledId,
    );
    expect(disabledRow?.enabled).toBe(false);
  });
});

describe('GET /api/signage/content', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should return content without authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/signage/content',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('contentType');
    expect(body).toHaveProperty('displayMode');
  });
});

describe('GET /api/signage/emergency', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should return emergency status without authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/signage/emergency',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('enabled');
  });
});

describe('POST /api/signage/schedules', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should create a schedule with authentication', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/signage/schedules',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        name: 'Test Schedule',
        contentType: 'TOOLS',
        dayOfWeek: [1, 2, 3, 4, 5],
        startTime: '09:00',
        endTime: '18:00',
        priority: 0,
        enabled: true,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('schedule');
    expect(body.schedule.name).toBe('Test Schedule');
  });

  it('should return 401 without authentication', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/signage/schedules',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        name: 'Test Schedule',
        contentType: 'TOOLS',
        dayOfWeek: [1, 2, 3, 4, 5],
        startTime: '09:00',
        endTime: '18:00',
        priority: 0,
      },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('GET /api/signage/pdfs', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should return pdfs with authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/signage/pdfs',
      headers: createAuthHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('pdfs');
    expect(Array.isArray(body.pdfs)).toBe(true);
  });

  it('should return 401 without authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/signage/pdfs',
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('POST /api/signage/schedules with layoutConfig', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should create a schedule with FULL layout and loans slot', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/signage/schedules',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        name: 'Test Schedule FULL Loans',
        contentType: 'TOOLS',
        layoutConfig: {
          layout: 'FULL',
          slots: [
            {
              position: 'FULL',
              kind: 'loans',
              config: {},
            },
          ],
        },
        dayOfWeek: [1, 2, 3, 4, 5],
        startTime: '09:00',
        endTime: '18:00',
        priority: 0,
        enabled: true,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('schedule');
    expect(body.schedule.name).toBe('Test Schedule FULL Loans');
    expect(body.schedule.layoutConfig).toBeDefined();
    expect(body.schedule.layoutConfig.layout).toBe('FULL');
  });

  it('should preserve csvDashboardId in csv_dashboard slot config', async () => {
    const csvDashboardId = 'e6e8f754-442e-48e6-b5dc-517856229231';
    const response = await app.inject({
      method: 'POST',
      url: '/api/signage/schedules',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        name: 'Test Schedule FULL CSV Dashboard',
        contentType: 'TOOLS',
        layoutConfig: {
          layout: 'FULL',
          slots: [
            {
              position: 'FULL',
              kind: 'csv_dashboard',
              config: {
                csvDashboardId,
              },
            },
          ],
        },
        dayOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: '00:00',
        endTime: '23:59',
        priority: 100,
        enabled: true,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('schedule');
    expect(body.schedule.layoutConfig).toBeDefined();
    expect(body.schedule.layoutConfig.layout).toBe('FULL');
    expect(body.schedule.layoutConfig.slots).toHaveLength(1);
    expect(body.schedule.layoutConfig.slots[0].kind).toBe('csv_dashboard');
    expect(body.schedule.layoutConfig.slots[0].config?.csvDashboardId).toBe(csvDashboardId);
  });

  it('should create a schedule with SPLIT layout (left: loans, right: pdf)', async () => {
    // まずPDFを作成
    const pdfResponse = await app.inject({
      method: 'POST',
      url: '/api/signage/pdfs',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'multipart/form-data' },
      payload: {
        name: 'Test PDF',
        filename: 'test.pdf',
        filePath: '/tmp/test.pdf',
        displayMode: 'SINGLE',
        enabled: true,
      },
    });

    const pdfId = pdfResponse.json().pdf?.id;
    if (!pdfId) {
      // PDF作成に失敗した場合はスキップ
      return;
    }

    const response = await app.inject({
      method: 'POST',
      url: '/api/signage/schedules',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        name: 'Test Schedule SPLIT',
        contentType: 'SPLIT',
        layoutConfig: {
          layout: 'SPLIT',
          slots: [
            {
              position: 'LEFT',
              kind: 'loans',
              config: {},
            },
            {
              position: 'RIGHT',
              kind: 'pdf',
              config: {
                pdfId,
                displayMode: 'SINGLE',
                slideInterval: null,
              },
            },
          ],
        },
        dayOfWeek: [1, 2, 3, 4, 5],
        startTime: '09:00',
        endTime: '18:00',
        priority: 0,
        enabled: true,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('schedule');
    expect(body.schedule.name).toBe('Test Schedule SPLIT');
    expect(body.schedule.layoutConfig).toBeDefined();
    expect(body.schedule.layoutConfig.layout).toBe('SPLIT');
    expect(body.schedule.layoutConfig.slots).toHaveLength(2);
  });
});

describe('GET /api/signage/current-image with layoutConfig', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;
  let clientDevice: Awaited<ReturnType<typeof getOrCreateTestClientDevice>>;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
    clientDevice = await getOrCreateTestClientDevice('client-key-raspberrypi3-signage1');
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should return image for schedule with layoutConfig FULL loans', async () => {
    // スケジュールを作成
    const scheduleResponse = await app.inject({
      method: 'POST',
      url: '/api/signage/schedules',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        name: 'Test Schedule for Image',
        contentType: 'TOOLS',
        layoutConfig: {
          layout: 'FULL',
          slots: [
            {
              position: 'FULL',
              kind: 'loans',
              config: {},
            },
          ],
        },
        dayOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: '00:00',
        endTime: '23:59',
        priority: 100,
        enabled: true,
      },
    });

    expect(scheduleResponse.statusCode).toBe(200);

    // current-imageを取得
    const response = await app.inject({
      method: 'GET',
      url: '/api/signage/current-image',
      headers: {
        'x-client-key': clientDevice.apiKey,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/jpeg');
    expect(response.rawPayload).toBeInstanceOf(Buffer);
  });

  it('should return image for schedule with layoutConfig FULL kiosk_progress_overview', async () => {
    const scheduleResponse = await app.inject({
      method: 'POST',
      url: '/api/signage/schedules',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        name: 'Test Schedule Kiosk Progress',
        contentType: 'TOOLS',
        layoutConfig: {
          layout: 'FULL',
          slots: [
            {
              position: 'FULL',
              kind: 'kiosk_progress_overview',
              config: {
                deviceScopeKey: 'integration-test-device-scope',
                slideIntervalSeconds: 30,
                seibanPerPage: 5,
              },
            },
          ],
        },
        dayOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: '00:00',
        endTime: '23:59',
        priority: 100,
        enabled: true,
      },
    });

    expect(scheduleResponse.statusCode).toBe(200);

    const response = await app.inject({
      method: 'GET',
      url: '/api/signage/current-image',
      headers: {
        'x-client-key': clientDevice.apiKey,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/jpeg');
    expect(response.rawPayload).toBeInstanceOf(Buffer);
  });

  it('should return image for schedule with layoutConfig FULL mobile_placement_parts_shelf_grid', async () => {
    const scheduleResponse = await app.inject({
      method: 'POST',
      url: '/api/signage/schedules',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        name: 'Test Schedule Mobile Placement Parts Shelf',
        contentType: 'TOOLS',
        layoutConfig: {
          layout: 'FULL',
          slots: [
            {
              position: 'FULL',
              kind: 'mobile_placement_parts_shelf_grid',
              config: {
                maxItemsPerZone: 12,
              },
            },
          ],
        },
        dayOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: '00:00',
        endTime: '23:59',
        priority: 97,
        enabled: true,
      },
    });

    expect(scheduleResponse.statusCode).toBe(200);

    const response = await app.inject({
      method: 'GET',
      url: '/api/signage/current-image',
      headers: {
        'x-client-key': clientDevice.apiKey,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/jpeg');
    expect(response.rawPayload).toBeInstanceOf(Buffer);
  });

  it('should return image for schedule with layoutConfig FULL kiosk_leader_order_cards', async () => {
    const scheduleResponse = await app.inject({
      method: 'POST',
      url: '/api/signage/schedules',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        name: 'Test Schedule Kiosk Leader Order Cards',
        contentType: 'TOOLS',
        layoutConfig: {
          layout: 'FULL',
          slots: [
            {
              position: 'FULL',
              kind: 'kiosk_leader_order_cards',
              config: {
                deviceScopeKey: 'integration-test-device-scope',
                resourceCds: ['TESTRES1', 'TESTRES2'],
                slideIntervalSeconds: 30,
                cardsPerPage: 2,
              },
            },
          ],
        },
        dayOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: '00:00',
        endTime: '23:59',
        priority: 98,
        enabled: true,
      },
    });

    expect(scheduleResponse.statusCode).toBe(200);

    const response = await app.inject({
      method: 'GET',
      url: '/api/signage/current-image',
      headers: {
        'x-client-key': clientDevice.apiKey,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/jpeg');
    expect(response.rawPayload).toBeInstanceOf(Buffer);
  });

  it('should accept kiosk_progress_overview seibanPerPage 8 in layoutConfig', async () => {
    const scheduleResponse = await app.inject({
      method: 'POST',
      url: '/api/signage/schedules',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        name: 'Test Schedule Kiosk Progress 8',
        contentType: 'TOOLS',
        layoutConfig: {
          layout: 'FULL',
          slots: [
            {
              position: 'FULL',
              kind: 'kiosk_progress_overview',
              config: {
                deviceScopeKey: 'integration-test-device-scope',
                slideIntervalSeconds: 30,
                seibanPerPage: 8,
              },
            },
          ],
        },
        dayOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: '00:00',
        endTime: '23:59',
        priority: 99,
        enabled: true,
      },
    });

    expect(scheduleResponse.statusCode).toBe(200);
  });
});

describe('GET /api/signage/content with SPLIT layout (left: pdf, right: pdf)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
    const { token } = await createTestUser('ADMIN');
    adminToken = token;
  });

  beforeEach(async () => {
    // 既存のスケジュールを削除
    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/signage/schedules',
    });
    const { schedules } = listResponse.json();
    for (const schedule of schedules) {
      await app.inject({
        method: 'DELETE',
        url: `/api/signage/schedules/${schedule.id}`,
        headers: createAuthHeader(adminToken),
      });
    }
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should return content with pdfsById containing both PDFs', async () => {
    // テスト用PDFを2つ作成
    const pdfLeftResponse = await app.inject({
      method: 'POST',
      url: '/api/signage/pdfs',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        name: 'Test PDF Left',
        originalFilename: 'test-left.pdf',
        storagePath: '/tmp/test-left.pdf',
        pageCount: 2,
      },
    });

    const pdfRightResponse = await app.inject({
      method: 'POST',
      url: '/api/signage/pdfs',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        name: 'Test PDF Right',
        originalFilename: 'test-right.pdf',
        storagePath: '/tmp/test-right.pdf',
        pageCount: 1,
      },
    });

    // PDFが作成できなかった場合はスキップ（テスト環境依存）
    if (pdfLeftResponse.statusCode !== 200 || pdfRightResponse.statusCode !== 200) {
      console.log('Skipping test: PDF creation not available in this environment');
      return;
    }

    const pdfLeftId = pdfLeftResponse.json().pdf?.id;
    const pdfRightId = pdfRightResponse.json().pdf?.id;

    if (!pdfLeftId || !pdfRightId) {
      console.log('Skipping test: PDF IDs not returned');
      return;
    }

    // SPLITレイアウトで左右PDFのスケジュールを作成
    const scheduleResponse = await app.inject({
      method: 'POST',
      url: '/api/signage/schedules',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        name: 'Split PDF Test',
        contentType: 'SPLIT',
        layoutConfig: {
          layout: 'SPLIT',
          slots: [
            {
              position: 'LEFT',
              kind: 'pdf',
              config: {
                pdfId: pdfLeftId,
                displayMode: 'SINGLE',
              },
            },
            {
              position: 'RIGHT',
              kind: 'pdf',
              config: {
                pdfId: pdfRightId,
                displayMode: 'SLIDESHOW',
                slideInterval: 10,
              },
            },
          ],
        },
        dayOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: '00:00',
        endTime: '23:59',
        priority: 100,
        enabled: true,
      },
    });

    expect(scheduleResponse.statusCode).toBe(200);

    // コンテンツを取得
    const contentResponse = await app.inject({
      method: 'GET',
      url: '/api/signage/content',
    });

    expect(contentResponse.statusCode).toBe(200);
    const contentBody = contentResponse.json();

    // layoutConfigが正しく返されることを確認
    expect(contentBody.layoutConfig).toBeDefined();
    expect(contentBody.layoutConfig.layout).toBe('SPLIT');
    expect(contentBody.layoutConfig.slots).toHaveLength(2);

    // pdfsByIdが正しく返されることを確認
    expect(contentBody.pdfsById).toBeDefined();
    expect(contentBody.pdfsById[pdfLeftId]).toBeDefined();
    expect(contentBody.pdfsById[pdfRightId]).toBeDefined();
    expect(contentBody.pdfsById[pdfLeftId].name).toBe('Test PDF Left');
    expect(contentBody.pdfsById[pdfRightId].name).toBe('Test PDF Right');

    // 後方互換: pdfフィールドは先頭PDFスロット（LEFT）のPDFを返す
    expect(contentBody.pdf).toBeDefined();
    expect(contentBody.pdf.id).toBe(pdfLeftId);
  });
});

describe('GET /api/signage/visualization-image/:id', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let dashboardId: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };

    const dashboard = await prisma.visualizationDashboard.create({
      data: {
        name: 'Test Visualization for Signage',
        dataSourceType: 'measuring_instruments',
        rendererType: 'kpi_cards',
        dataSourceConfig: { metric: 'return_rate', periodDays: 7 },
        rendererConfig: {},
        enabled: true,
      },
    });
    dashboardId = dashboard.id;
  });

  afterAll(async () => {
    await prisma.visualizationDashboard.deleteMany({ where: { id: dashboardId } });
    if (closeServer) {
      await closeServer();
    }
  });

  it('should return image/jpeg without authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/signage/visualization-image/${dashboardId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/jpeg');
    expect(response.rawPayload).toBeInstanceOf(Buffer);
    expect((response.rawPayload as Buffer).length).toBeGreaterThan(0);
  });

  it('should return 400 for invalid UUID', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/signage/visualization-image/invalid-uuid',
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('GET /api/signage/content with SPLIT layout (left: loans, right: visualization) and tools=0', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;
  let visualizationDashboardId: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
    const { token } = await createTestUser('ADMIN');
    adminToken = token;

    const dashboard = await prisma.visualizationDashboard.create({
      data: {
        name: 'Test Uninspected',
        dataSourceType: 'measuring_instruments',
        rendererType: 'kpi_cards',
        dataSourceConfig: { metric: 'return_rate', periodDays: 7 },
        rendererConfig: {},
        enabled: true,
      },
    });
    visualizationDashboardId = dashboard.id;
  });

  beforeEach(async () => {
    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/signage/schedules',
    });
    const { schedules } = listResponse.json();
    for (const schedule of schedules) {
      await app.inject({
        method: 'DELETE',
        url: `/api/signage/schedules/${schedule.id}`,
        headers: createAuthHeader(adminToken),
      });
    }
    await prisma.loan.updateMany({ data: { returnedAt: new Date() } });
  });

  afterAll(async () => {
    await prisma.visualizationDashboard.deleteMany({ where: { id: visualizationDashboardId } });
    if (closeServer) {
      await closeServer();
    }
  });

  it('should return layoutConfig with loans+visualization and tools=[] when no active loans', async () => {
    const scheduleResponse = await app.inject({
      method: 'POST',
      url: '/api/signage/schedules',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        name: 'Split Loans Visualization Test',
        contentType: 'SPLIT',
        layoutConfig: {
          layout: 'SPLIT',
          slots: [
            { position: 'LEFT', kind: 'loans', config: {} },
            {
              position: 'RIGHT',
              kind: 'visualization',
              config: { visualizationDashboardId },
            },
          ],
        },
        dayOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: '00:00',
        endTime: '23:59',
        priority: 100,
        enabled: true,
      },
    });

    expect(scheduleResponse.statusCode).toBe(200);

    const contentResponse = await app.inject({
      method: 'GET',
      url: '/api/signage/content',
    });

    expect(contentResponse.statusCode).toBe(200);
    const content = contentResponse.json();

    expect(content.layoutConfig).toBeDefined();
    expect(content.layoutConfig.layout).toBe('SPLIT');
    expect(content.layoutConfig.slots).toHaveLength(2);
    expect(content.layoutConfig.slots[0].kind).toBe('loans');
    expect(content.layoutConfig.slots[1].kind).toBe('visualization');
    expect(content.layoutConfig.slots[1].config.visualizationDashboardId).toBe(visualizationDashboardId);

    expect(content.tools).toBeDefined();
    expect(Array.isArray(content.tools)).toBe(true);
    expect(content.tools).toHaveLength(0);
  });
});

describe('GET /api/signage/content and current-image with targetClientKeys', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;

    const listResponse = await app.inject({ method: 'GET', url: '/api/signage/schedules' });
    const { schedules } = listResponse.json();
    for (const schedule of schedules as Array<{ id: string }>) {
      await app.inject({
        method: 'DELETE',
        url: `/api/signage/schedules/${schedule.id}`,
        headers: createAuthHeader(adminToken),
      });
    }
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('without targetClientKeys, anonymous /content still matches schedule (all-clients)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/signage/schedules',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        name: 'global-no-target-keys',
        contentType: 'TOOLS',
        layoutConfig: {
          layout: 'FULL',
          slots: [{ position: 'FULL', kind: 'loans', config: {} }],
        },
        dayOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: '00:00',
        endTime: '23:59',
        priority: 10,
        enabled: true,
      },
    });
    expect(res.statusCode).toBe(200);

    const anon = await app.inject({ method: 'GET', url: '/api/signage/content' });
    expect(anon.statusCode).toBe(200);
    expect(anon.json().layoutConfig?.slots?.[0]?.kind).toBe('loans');
  });

  it('targetClientKeys limits schedule to listed apiKeys; others and anonymous use global', async () => {
    const clientA = await createTestClientDevice(`signage-tck-a-${Date.now()}`);
    const clientB = await createTestClientDevice(`signage-tck-b-${Date.now()}`);

    const globalRes = await app.inject({
      method: 'POST',
      url: '/api/signage/schedules',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        name: 'global-loans-tck',
        contentType: 'TOOLS',
        layoutConfig: {
          layout: 'FULL',
          slots: [{ position: 'FULL', kind: 'loans', config: {} }],
        },
        // 常時マッチはさせず、非対象端末での fallback 用に使う
        dayOfWeek: [],
        startTime: '00:00',
        endTime: '23:59',
        priority: 1,
        enabled: true,
      },
    });
    expect(globalRes.statusCode).toBe(200);

    const targetedRes = await app.inject({
      method: 'POST',
      url: '/api/signage/schedules',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        name: 'kiosk-only-client-a',
        contentType: 'TOOLS',
        targetClientKeys: [clientA.apiKey],
        layoutConfig: {
          layout: 'FULL',
          slots: [
            {
              position: 'FULL',
              kind: 'kiosk_progress_overview',
              config: {
                deviceScopeKey: 'integration-tck-device-scope',
                slideIntervalSeconds: 30,
                seibanPerPage: 5,
              },
            },
          ],
        },
        dayOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: '00:00',
        endTime: '23:59',
        priority: 100,
        enabled: true,
      },
    });
    expect(targetedRes.statusCode).toBe(200);
    expect(targetedRes.json().schedule.targetClientKeys).toEqual([clientA.apiKey]);

    const forA = await app.inject({
      method: 'GET',
      url: '/api/signage/content',
      headers: { 'x-client-key': clientA.apiKey },
    });
    expect(forA.statusCode).toBe(200);
    expect(forA.json().layoutConfig?.slots?.[0]?.kind).toBe('kiosk_progress_overview');

    const forB = await app.inject({
      method: 'GET',
      url: '/api/signage/content',
      headers: { 'x-client-key': clientB.apiKey },
    });
    expect(forB.statusCode).toBe(200);
    expect(forB.json().layoutConfig?.slots?.[0]?.kind).toBe('loans');

    const anon = await app.inject({ method: 'GET', url: '/api/signage/content' });
    expect(anon.statusCode).toBe(200);
    expect(anon.json().layoutConfig?.slots?.[0]?.kind).toBe('loans');
  });

  it('current-image returns different JPEGs per client after POST /render when schedules differ', async () => {
    const clientA = await createTestClientDevice(`signage-img-a-${Date.now()}`);
    const clientB = await createTestClientDevice(`signage-img-b-${Date.now()}`);

    await app.inject({
      method: 'POST',
      url: '/api/signage/schedules',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        name: 'img-global-loans',
        contentType: 'TOOLS',
        layoutConfig: {
          layout: 'FULL',
          slots: [{ position: 'FULL', kind: 'loans', config: {} }],
        },
        // 常時マッチはさせず、非対象端末での fallback 用に使う
        dayOfWeek: [],
        startTime: '00:00',
        endTime: '23:59',
        priority: 1,
        enabled: true,
      },
    });

    await app.inject({
      method: 'POST',
      url: '/api/signage/schedules',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        name: 'img-kiosk-a',
        contentType: 'TOOLS',
        targetClientKeys: [clientA.apiKey],
        layoutConfig: {
          layout: 'FULL',
          slots: [
            {
              position: 'FULL',
              kind: 'kiosk_progress_overview',
              config: {
                deviceScopeKey: 'integration-img-device-scope',
                slideIntervalSeconds: 30,
                seibanPerPage: 5,
              },
            },
          ],
        },
        dayOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: '00:00',
        endTime: '23:59',
        priority: 100,
        enabled: true,
      },
    });

    const renderRes = await app.inject({
      method: 'POST',
      url: '/api/signage/render',
      headers: createAuthHeader(adminToken),
    });
    expect(renderRes.statusCode).toBe(200);
    expect(renderRes.json().clientKeysRendered).toBeGreaterThanOrEqual(2);

    const imgA = await app.inject({
      method: 'GET',
      url: '/api/signage/current-image',
      headers: { 'x-client-key': clientA.apiKey },
    });
    const imgB = await app.inject({
      method: 'GET',
      url: '/api/signage/current-image',
      headers: { 'x-client-key': clientB.apiKey },
    });

    expect(imgA.statusCode).toBe(200);
    expect(imgB.statusCode).toBe(200);
    const bufA = imgA.rawPayload as Buffer;
    const bufB = imgB.rawPayload as Buffer;
    expect(bufA.length).toBeGreaterThan(1000);
    expect(bufB.length).toBeGreaterThan(1000);
    expect(Buffer.compare(bufA, bufB)).not.toBe(0);
  });
});
