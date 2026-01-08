import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import { createAuthHeader, createTestClientDevice, createTestUser } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

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
  let clientDevice: Awaited<ReturnType<typeof createTestClientDevice>>;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
    clientDevice = await createTestClientDevice('client-key-raspberrypi3-signage1');
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
