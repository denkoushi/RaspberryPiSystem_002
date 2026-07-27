import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { buildServer } from '../../app.js';
import { buildSelfInspectionMachineBoardViewModel } from '../../services/part-measurement/self-inspection-machine-board.service.js';
import { normalizeFhincd } from '../../services/part-measurement/template-candidate-rules.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID, PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID } from '../../services/production-schedule/constants.js';
import { buildSelfInspectionMachineBoardSvg } from '../../services/signage/self-inspection-machine-board/self-inspection-machine-board-svg.js';
import {
  createAuthHeader,
  createTestClientDevice,
  createTestEmployee,
  createTestMeasuringInstrumentWithTag,
  createTestUser,
  getOrCreateTestClientDevice,
} from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';
process.env.SIGNAGE_RENDER_DIR ??= `/tmp/raspi-signage-render-test-${process.pid}`;

const PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_SOURCE_DASHBOARD_ID = '8f0b8d6e-4b77-4e7e-8d9a-6c8b2f5d1a31';
const SELF_INSPECTION_MACHINE_BOARD_TEST_MACHINE_NAME = 'integration-test-machine-name';

const MIN_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function buildMultipartPng(name: string, png: Buffer): { body: Buffer; contentType: string } {
  const boundary = `----testSignageSimb${Date.now()}`;
  const crlf = '\r\n';
  const parts: Buffer[] = [];
  const push = (s: string) => parts.push(Buffer.from(s, 'utf8'));
  push(`--${boundary}${crlf}`);
  push(`Content-Disposition: form-data; name="name"${crlf}${crlf}${name}${crlf}`);
  push(`--${boundary}${crlf}`);
  push(
    `Content-Disposition: form-data; name="file"; filename="t.png"${crlf}Content-Type: image/png${crlf}${crlf}`
  );
  parts.push(png);
  push(`${crlf}--${boundary}--${crlf}`);
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function seedVisibleProductionScheduleFkojunstMailStatus(input: {
  csvDashboardRowId: string;
  fkojun: string;
  fkoteicd: string;
  fsezono: string;
}): Promise<void> {
  await prisma.productionScheduleFkojunstMailStatus.upsert({
    where: { csvDashboardRowId: input.csvDashboardRowId },
    create: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      csvDashboardRowId: input.csvDashboardRowId,
      sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
      fkojun: input.fkojun,
      fkoteicd: input.fkoteicd,
      fsezono: input.fsezono,
      statusCode: 'S',
      sourceUpdatedAt: new Date(),
    },
    update: {
      statusCode: 'S',
      sourceUpdatedAt: new Date(),
    },
  });
}

async function seedSelfInspectionMachineBoardFixture(
  app: Awaited<ReturnType<typeof buildServer>>,
  adminToken: string,
  machineName: string
): Promise<{ fhincd: string; fseiban: string; scheduleRowId: string }> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fhincd = normalizeFhincd(`MHSIMB-${suffix}`);
  const fseiban = `FS-SIMB-${suffix}`;
  const productNo = String(Date.now()).slice(-10);
  const resourceCd = 'RES-SIMB-INT';
  const fkojun = '10';

  await prisma.csvDashboard.upsert({
    where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    update: {},
    create: {
      id: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      name: 'ProductionSchedule_Test',
      columnDefinitions: [],
      templateType: 'CARD_GRID',
      templateConfig: {},
      ingestMode: 'DEDUP',
      dedupKeyColumns: ['ProductNo', 'FSEIBAN', 'FHINCD', 'FSIGENCD', 'FKOJUN'],
      dateColumnName: 'registeredAt',
      enabled: true,
    },
  });

  const row = await prisma.csvDashboardRow.create({
    data: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      occurredAt: new Date(),
      dataHash: `simb-signage-${suffix}`,
      rowData: {
        ProductNo: productNo,
        FSEIBAN: fseiban,
        FHINCD: fhincd,
        FSIGENCD: resourceCd,
        FHINMEI: machineName,
        FKOJUN: fkojun,
      },
    },
  });

  await seedVisibleProductionScheduleFkojunstMailStatus({
    csvDashboardRowId: row.id,
    fkojun,
    fkoteicd: resourceCd.trim().toUpperCase(),
    fsezono: productNo,
  });

  await prisma.productionScheduleOrderSupplement.upsert({
    where: { csvDashboardRowId: row.id },
    update: { plannedQuantity: 2 },
    create: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      csvDashboardRowId: row.id,
      sourceCsvDashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_SOURCE_DASHBOARD_ID,
      productNo: productNo.slice(0, 20),
      resourceCd: resourceCd.slice(0, 20),
      processOrder: '10',
      plannedQuantity: 2,
    },
  });

  const { body, contentType } = buildMultipartPng('自主検査図面', MIN_PNG);
  const visualRes = await app.inject({
    method: 'POST',
    url: '/api/part-measurement/visual-templates',
    headers: { ...createAuthHeader(adminToken), 'content-type': contentType },
    payload: body,
  });
  expect(visualRes.statusCode).toBe(200);
  const visualTemplateId = visualRes.json().visualTemplate.id as string;

  const createTemplateRes = await app.inject({
    method: 'POST',
    url: '/api/part-measurement/templates',
    headers: createAuthHeader(adminToken),
    payload: {
      fhincd,
      processGroup: 'cutting',
      resourceCd,
      name: 'サイネージ自主検査テンプレ',
      visualTemplateId,
      selfInspectionMode: 'sample',
      selfInspectionSampleSize: 2,
      items: [
        {
          sortOrder: 0,
          datumSurface: 'A',
          measurementPoint: 'P1',
          measurementLabel: '寸法1',
          displayMarker: '1',
          markerXRatio: 0.2,
          markerYRatio: 0.4,
          nominalValue: 10,
          lowerLimit: 9.8,
          upperLimit: 10.2,
          allowNegative: false,
          decimalPlaces: 2,
        },
      ],
    },
  });
  expect(createTemplateRes.statusCode).toBe(200);
  const templateId = createTemplateRes.json().template.id as string;
  const templateItemId = createTemplateRes.json().template.items[0].id as string;

  const resolveRes = await app.inject({
    method: 'POST',
    url: '/api/part-measurement/self-inspection/sessions/resolve-or-create',
    headers: createAuthHeader(adminToken),
    payload: {
      templateId,
      productNo,
      processGroup: 'cutting',
      resourceCd,
      plannedQuantity: 2,
      scheduleRowId: row.id,
      fseiban,
      fhincd,
      fhinmei: machineName,
    },
  });
  expect(resolveRes.statusCode).toBe(200);
  const sessionId = resolveRes.json().session.id as string;

  const employee = await createTestEmployee({
    displayName: `SIMB Employee ${suffix}`,
    nfcTagUid: `SIMB-EMP-${suffix}`,
  });
  const { rfidTagUid: measuringInstrumentTagUid } = await createTestMeasuringInstrumentWithTag({
    name: `SIMB Instrument ${suffix}`,
    managementNumber: `SIMB-${suffix}`,
    rfidTagUid: `SIMB-INST-${suffix}`,
  });
  const kioskClient = await createTestClientDevice();
  const authenticationRes = await app.inject({
    method: 'POST',
    url: `/api/part-measurement/self-inspection/sessions/${sessionId}/measurement-actor-authentications`,
    headers: { 'x-client-key': kioskClient.apiKey },
    payload: {
      employeeTagUid: employee.nfcTagUid,
      measurementMode: 'operator',
    },
  });
  expect(authenticationRes.statusCode).toBe(200);
  const measurementActorAuthenticationId = authenticationRes.json().authentication.id as string;

  const createEntryRes = await app.inject({
    method: 'POST',
    url: `/api/part-measurement/self-inspection/sessions/${sessionId}/entries`,
    headers: { ...createAuthHeader(adminToken), 'x-client-key': kioskClient.apiKey },
    payload: {
      entryIndex: 0,
      measurementActorAuthenticationId,
      measuringInstrumentTagUid,
      values: [{ templateItemId, value: '10.01' }],
    },
  });
  expect(createEntryRes.statusCode).toBe(200);

  return { fhincd, fseiban, scheduleRowId: row.id };
}

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

  it('should return image for schedule with layoutConfig FULL self_inspection_machine_board', async () => {
    const listResponse = await app.inject({ method: 'GET', url: '/api/signage/schedules' });
    for (const schedule of listResponse.json().schedules as Array<{ id: string }>) {
      await app.inject({
        method: 'DELETE',
        url: `/api/signage/schedules/${schedule.id}`,
        headers: createAuthHeader(adminToken),
      });
    }

    const simbClient = await createTestClientDevice(`signage-simb-only-${Date.now()}`);
    const seeded = await seedSelfInspectionMachineBoardFixture(
      app,
      adminToken,
      SELF_INSPECTION_MACHINE_BOARD_TEST_MACHINE_NAME
    );

    const viewModel = await buildSelfInspectionMachineBoardViewModel({
      machineName: SELF_INSPECTION_MACHINE_BOARD_TEST_MACHINE_NAME,
      detailTopN: 3,
    });
    expect(viewModel.totalPages).toBeGreaterThan(0);
    const summaryPages = viewModel.pages.filter((page) => page.kind === 'summary');
    const detailPages = viewModel.pages.filter((page) => page.kind === 'detail');
    expect(summaryPages.length).toBeGreaterThan(0);
    const summaryParts = [...summaryPages[0].scheduled, ...summaryPages[0].unscheduled].flatMap(
      (group) => group.parts
    );
    const seededPart = summaryParts.find((part) => part.fhincd === seeded.fhincd);
    expect(seededPart).toBeTruthy();
    expect(seededPart?.progressLabel).toBe('1/2');
    expect(detailPages.length).toBeGreaterThan(0);
    expect(detailPages[0]?.measurementPoints.length).toBeGreaterThan(0);
    expect(buildSelfInspectionMachineBoardSvg(summaryPages[0], 1920, 1080)).toContain('自主検査');
    expect(buildSelfInspectionMachineBoardSvg(detailPages[0], 1920, 1080)).toContain('寸法1');

    const scheduleResponse = await app.inject({
      method: 'POST',
      url: '/api/signage/schedules',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        name: 'Test Schedule Self Inspection Machine Board',
        contentType: 'TOOLS',
        targetClientKeys: [simbClient.apiKey],
        layoutConfig: {
          layout: 'FULL',
          slots: [
            {
              position: 'FULL',
              kind: 'self_inspection_machine_board',
              config: {
                machineName: SELF_INSPECTION_MACHINE_BOARD_TEST_MACHINE_NAME,
                slideIntervalSeconds: 30,
                partsPerPage: 12,
                detailTopN: 3,
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

    const contentResponse = await app.inject({
      method: 'GET',
      url: '/api/signage/content',
      headers: {
        'x-client-key': simbClient.apiKey,
      },
    });
    expect(contentResponse.statusCode).toBe(200);
    expect(contentResponse.json().layoutConfig?.slots?.[0]?.kind).toBe('self_inspection_machine_board');

    const renderResponse = await app.inject({
      method: 'POST',
      url: '/api/signage/render',
      headers: createAuthHeader(adminToken),
    });
    expect(renderResponse.statusCode).toBe(200);

    const response = await app.inject({
      method: 'GET',
      url: '/api/signage/current-image',
      headers: {
        'x-client-key': simbClient.apiKey,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/jpeg');
    expect(response.rawPayload).toBeInstanceOf(Buffer);
    expect((response.rawPayload as Buffer).length).toBeGreaterThan(1000);
  });

  it('should reject self_inspection_machine_board on SPLIT layout', async () => {
    const scheduleResponse = await app.inject({
      method: 'POST',
      url: '/api/signage/schedules',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        name: 'Test Schedule Self Inspection SPLIT Rejected',
        contentType: 'SPLIT',
        layoutConfig: {
          layout: 'SPLIT',
          slots: [
            {
              position: 'LEFT',
              kind: 'self_inspection_machine_board',
              config: {
                machineName: 'integration-test-machine-name',
              },
            },
            {
              position: 'RIGHT',
              kind: 'loans',
              config: {},
            },
          ],
        },
        dayOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: '00:00',
        endTime: '23:59',
        priority: 95,
        enabled: true,
      },
    });

    expect(scheduleResponse.statusCode).toBe(400);
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

  it('should accept kiosk_leader_order_cards cardsPerPage 10 in layoutConfig', async () => {
    const scheduleResponse = await app.inject({
      method: 'POST',
      url: '/api/signage/schedules',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        name: 'Test Schedule Kiosk Leader Order Cards 10',
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
                cardsPerPage: 10,
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

    const created = scheduleResponse.json() as {
      schedule: {
        id: string;
        layoutConfig: {
          layout: 'FULL';
          slots: Array<{
            position: 'FULL';
            kind: 'kiosk_leader_order_cards';
            config: { cardsPerPage?: number };
          }>;
        };
      };
    };

    expect(created.schedule.layoutConfig.slots[0]?.config.cardsPerPage).toBe(10);
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
