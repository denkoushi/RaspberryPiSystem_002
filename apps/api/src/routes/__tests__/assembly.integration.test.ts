import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
  SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL
} from '../../services/production-schedule/constants.js';
import { normalizeMachineNameForCompare } from '../../services/production-schedule/machine-name-compare.js';
import { resetMachineNameFseibanMatchCaches } from '../../services/production-schedule/machine-name-fseiban-match.service.js';
import { SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION } from '../../services/production-schedule/production-schedule-settings.service.js';
import { configureTestDueManagementAccessPassword } from '../../test/due-management-access-password.js';
import { createAuthHeader, createTestClientDevice, createTestEmployee, createTestUser } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';
process.env.PHOTO_STORAGE_DIR ??= '/tmp/test-assembly-torque';
process.env.SIGNAGE_RENDER_DIR ??= '/tmp/test-assembly-torque/signage';

const MIN_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const TEST_KIOSK_DOCUMENT_TITLE_PREFIX = 'Assembly Test Doc';
const MIN_JPG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

function buildMultipartProcedure(name: string): { body: Buffer; contentType: string } {
  const boundary = `----assemblyProcedure${Date.now()}`;
  const crlf = '\r\n';
  const parts: Buffer[] = [];
  const push = (s: string) => parts.push(Buffer.from(s, 'utf8'));
  push(`--${boundary}${crlf}`);
  push(`Content-Disposition: form-data; name="name"${crlf}${crlf}${name}${crlf}`);
  push(`--${boundary}${crlf}`);
  push(`Content-Disposition: form-data; name="file"; filename="procedure.png"${crlf}Content-Type: image/png${crlf}${crlf}`);
  parts.push(MIN_PNG);
  push(`${crlf}--${boundary}--${crlf}`);
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

function buildTemplatePayload(documentId: string, overrides: Partial<Record<'modelCode' | 'procedurePattern' | 'name', string>> = {}) {
  const modelCode = overrides.modelCode ?? 'DFL7161';
  const procedurePattern = overrides.procedurePattern ?? '手順7';
  return {
    modelCode,
    procedurePattern,
    name: overrides.name ?? `${modelCode} ${procedurePattern}`,
    procedureDocumentId: documentId,
    areas: [
      {
        sortOrder: 0,
        processNo: '7',
        areaCode: '13',
        areaName: 'ストッパー取付',
        unitCode: 'U1',
        requireManualAdvance: true,
        bolts: [
          {
            sortOrder: 0,
            tighteningId: 'P7-A13-U1-B1',
            markerNo: 1,
            xRatio: 0.25,
            yRatio: 0.25,
            boltSpec: 'M8x16',
            nominalTorque: 10,
            lowerLimit: 9,
            upperLimit: 11,
            unit: 'N-m'
          }
        ]
      }
    ]
  };
}

async function publishProcedureDocument(
  app: Awaited<ReturnType<typeof buildServer>>,
  headers: Record<string, string>,
  documentId: string
) {
  const publishHeaders =
    'x-client-key' in headers
      ? { 'x-client-key': headers['x-client-key'] }
      : headers;
  const publishRes = await app.inject({
    method: 'POST',
    url: `/api/assembly/procedure-documents/${documentId}/publish`,
    headers: { ...publishHeaders, 'Content-Type': 'application/json' },
    payload: { accessPassword: '2520' }
  });
  expect(publishRes.statusCode).toBe(200);
  expect(publishRes.json().document.status).toBe('published');
}

async function uploadPublishedProcedureDocument(
  app: Awaited<ReturnType<typeof buildServer>>,
  headers: Record<string, string>,
  name: string
) {
  const upload = buildMultipartProcedure(name);
  const docRes = await app.inject({
    method: 'POST',
    url: '/api/assembly/procedure-documents',
    headers: { ...headers, 'Content-Type': upload.contentType },
    payload: upload.body
  });
  expect(docRes.statusCode).toBe(200);
  const document = docRes.json().document as {
    id: string;
    status: string;
    imageRelativePath: string;
    name: string;
    pages: Array<{ pageIndex: number; imageRelativePath: string }>;
  };
  expect(document.status).toBe('draft');
  expect(document.pages.length).toBeGreaterThan(0);
  await publishProcedureDocument(app, headers, document.id);
  return document;
}

async function seedLegacyProcedureOrder(
  machineName: string,
  items: Array<{
    kioskDocumentId?: string | null;
    assemblyProcedureDocumentId?: string | null;
    label?: string | null;
  }>
): Promise<void> {
  const machineNameKey = normalizeMachineNameForCompare(machineName);
  const set = await prisma.assemblyProcedureOrderSet.upsert({
    where: { machineNameKey },
    create: { machineName: machineNameKey, machineNameKey },
    update: { machineName: machineNameKey }
  });
  await prisma.assemblyProcedureOrderItem.deleteMany({ where: { setId: set.id } });
  await prisma.assemblyProcedureOrderItem.createMany({
    data: items.map((item, sortOrder) => ({
      setId: set.id,
      sortOrder,
      label: item.label ?? null,
      kioskDocumentId: item.kioskDocumentId ?? null,
      assemblyProcedureDocumentId: item.assemblyProcedureDocumentId ?? null
    }))
  });
}

async function cleanAssemblyTables() {
  await prisma.assemblyProcedureOrderItem.deleteMany({});
  await prisma.assemblyProcedureOrderSet.deleteMany({});
  await prisma.assemblyWorkSessionOperatorAccess.deleteMany({});
  await prisma.assemblyWorkUnitInvalidation.deleteMany({});
  await prisma.assemblyWorkSessionApproval.deleteMany({});
  await prisma.assemblyAreaRestartLog.deleteMany({});
  await prisma.assemblyTorqueRecord.deleteMany({});
  await prisma.assemblyWorkSession.deleteMany({});
  await prisma.assemblyLotSerial.deleteMany({});
  await prisma.assemblyLot.deleteMany({});
  await prisma.assemblyFormalIdentifierAssignment.deleteMany({});
  await prisma.assemblyWorkUnitComposition.deleteMany({});
  await prisma.assemblyWorkUnit.deleteMany({});
  await prisma.assemblyTemplateBolt.deleteMany({});
  await prisma.assemblyTemplateArea.deleteMany({});
  await prisma.assemblyTemplate.deleteMany({});
  await prisma.assemblyCheckRecord.deleteMany({});
  await prisma.assemblyTemplateCheckItem.deleteMany({});
  await prisma.kioskDocument.deleteMany({ where: { title: { startsWith: TEST_KIOSK_DOCUMENT_TITLE_PREFIX } } });
  await prisma.assemblyProcedureDocumentPage.deleteMany({});
  await prisma.assemblyProcedureDocument.deleteMany({});
  await prisma.clientDevice.deleteMany({ where: { name: { startsWith: 'Test Client ' } } });
  await prisma.productionScheduleAccessPasswordConfig.deleteMany({
    where: { location: SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION }
  });
}

async function ensureProductionScheduleDashboard() {
  await prisma.csvDashboard.upsert({
    where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    create: {
      id: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      name: 'Test Production Schedule',
      columnDefinitions: [],
      templateConfig: {}
    },
    update: {}
  });
}

async function cleanAssemblySeibanSearchFixtures() {
  await prisma.csvDashboardRow.deleteMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      OR: [
        { rowData: { path: ['FSEIBAN'], string_starts_with: 'ASMTEST' } },
        { rowData: { path: ['FSEIBAN'], string_starts_with: 'ASM-START' } }
      ]
    }
  });
  await prisma.productionScheduleSeibanMachineNameSupplement.deleteMany({
    where: {
      sourceCsvDashboardId: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
      OR: [{ fseiban: { startsWith: 'ASMTEST' } }, { fseiban: { startsWith: 'ASM-START' } }]
    }
  });
}

async function createScheduleRow(rowData: Record<string, string>) {
  await prisma.csvDashboardRow.create({
    data: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      occurredAt: new Date(),
      rowData
    }
  });
}

function getPdfPagesBaseDir(): string {
  const storageBaseDir =
    process.env.PDF_STORAGE_DIR ||
    (process.env.NODE_ENV === 'test' ? '/tmp/test-photo-storage' : '/opt/RaspberryPiSystem_002/storage');
  return path.join(storageBaseDir, 'pdf-pages');
}

async function createKioskDocumentWithRenderedPages(params: {
  title: string;
  pageCount?: number;
  enabled?: boolean;
}) {
  const id = randomUUID();
  const pageCount = params.pageCount ?? 1;
  const document = await prisma.kioskDocument.create({
    data: {
      id,
      title: `${TEST_KIOSK_DOCUMENT_TITLE_PREFIX} ${params.title}`,
      displayTitle: params.title,
      filename: `${id}.pdf`,
      filePath: `/tmp/${id}.pdf`,
      sourceType: 'MANUAL',
      enabled: params.enabled ?? true,
      ocrStatus: 'COMPLETED',
      pageCount,
      confirmedDocumentNumber: `ASM-${params.title}`,
      confirmedSummaryText: `${params.title} の組立要領書`
    }
  });
  const pagesDir = path.join(getPdfPagesBaseDir(), id);
  await fs.mkdir(pagesDir, { recursive: true });
  for (let page = 1; page <= pageCount; page += 1) {
    await fs.writeFile(path.join(pagesDir, `page-${page}.jpg`), MIN_JPG);
  }
  return document;
}

describe('assembly torque management API', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let directStartOperatorNfcTagUid: string;

  beforeAll(async () => {
    app = await buildServer();
    directStartOperatorNfcTagUid = (
      await createTestEmployee({ displayName: '佐藤' })
    ).nfcTagUid;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    resetMachineNameFseibanMatchCaches();
    await cleanAssemblyTables();
    await configureTestDueManagementAccessPassword();
    await cleanAssemblySeibanSearchFixtures();
  });

  it('REQUIREDテンプレートは適合グループ付きで作成し、不完全な締付条件は一切残さない', async () => {
    const client = await createTestClientDevice();
    const headers = {
      'x-client-key': client.apiKey,
      'Content-Type': 'application/json'
    };
    const document = await uploadPublishedProcedureDocument(
      app,
      headers,
      'ガイド作成契約'
    );
    const capabilityGroup = await prisma.torqueWrenchCapabilityGroup.create({
      data: {
        name: `Assembly Guided Create ${randomUUID()}`,
        nominalDiameter: 'M6',
        boltLengthMm: 30,
        material: 'SCM435',
        strengthClass: '10.9'
      }
    });
    const requiredPayload = (modelCode: string) => ({
      modelCode,
      procedurePattern: '標準',
      name: `${modelCode} 標準`,
      procedureDocumentId: document.id,
      traceabilityMode: 'REQUIRED',
      areas: [
        {
          sortOrder: 0,
          processNo: '10',
          areaCode: 'A1',
          areaName: '本体組立',
          unitCode: 'U1',
          requireManualAdvance: true,
          bolts: [
            {
              sortOrder: 0,
              markerNo: 1,
              xRatio: 0.5,
              yRatio: 0.5,
              boltSpec: 'M6×30 / SCM435 / 10.9',
              nominalDiameter: 'Ｍ ６',
              boltLengthMm: 30,
              material: 'scm 435',
              strengthClass: '10.9',
              capabilityGroupId: capabilityGroup.id,
              nominalTorque: 10,
              lowerLimit: 9,
              upperLimit: 11,
              unit: 'N·m'
            }
          ]
        }
      ]
    });

    const createdResponse = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload: requiredPayload('GUIDED-VALID')
    });
    expect(createdResponse.statusCode).toBe(200);
    const createdId = createdResponse.json().template.id as string;
    const stored = await prisma.assemblyTemplate.findUniqueOrThrow({
      where: { id: createdId },
      include: {
        procedureDocument: true,
        areas: { include: { bolts: true } }
      }
    });
    expect(stored).toMatchObject({
      modelCode: 'GUIDED-VALID',
      traceabilityMode: 'REQUIRED',
      procedureDocument: { id: document.id }
    });
    expect(stored.areas).toHaveLength(1);
    expect(stored.areas[0]!.bolts).toHaveLength(1);
    expect(stored.areas[0]!.bolts[0]).toMatchObject({
      nominalDiameter: 'M6',
      material: 'SCM435',
      strengthClass: '10.9',
      capabilityGroupId: capabilityGroup.id
    });

    const withoutBolts = requiredPayload('GUIDED-NO-BOLTS');
    withoutBolts.areas[0]!.bolts = [];
    const withoutBoltsResponse = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload: withoutBolts
    });
    expect(withoutBoltsResponse.statusCode).toBe(400);

    const withoutCondition = requiredPayload('GUIDED-NO-CONDITION');
    withoutCondition.areas[0]!.bolts[0]!.nominalDiameter = '';
    const withoutConditionResponse = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload: withoutCondition
    });
    expect(withoutConditionResponse.statusCode).toBe(400);

    const mismatchedGroup = requiredPayload('GUIDED-GROUP-MISMATCH');
    mismatchedGroup.areas[0]!.bolts[0]!.material = 'SUS304';
    const mismatchedGroupResponse = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload: mismatchedGroup
    });
    expect(mismatchedGroupResponse.statusCode).toBe(400);

    expect(
      await prisma.assemblyTemplate.count({
        where: { modelCode: { startsWith: 'GUIDED-', not: 'GUIDED-VALID' } }
      })
    ).toBe(0);

    const changedPattern = await app.inject({
      method: 'POST',
      url: `/api/assembly/templates/${createdId}/revise`,
      headers,
      payload: { procedurePattern: '別パターン' }
    });
    expect(changedPattern.statusCode).toBe(400);
    expect(
      await prisma.assemblyTemplate.findUnique({
        where: { id: createdId },
        select: { isActive: true, version: true }
      })
    ).toEqual({ isActive: true, version: 1 });
  });

  it('同一作業セッションの同時取消は1件だけ成功する', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey };
    const document = await uploadPublishedProcedureDocument(app, headers, '競合制御手順');
    const templateRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: buildTemplatePayload(document.id, {
        modelCode: 'LOCK-TEST',
        procedurePattern: '標準',
        name: '競合制御テンプレート',
      }),
    });
    expect(templateRes.statusCode).toBe(200);

    const startRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: {
        templateId: templateRes.json().template.id,
        productNo: 'LOCK-PRODUCT',
        serialNo: 'LOCK-SERIAL',
        operatorNfcTagUid: directStartOperatorNfcTagUid,
        requestId: randomUUID(),
        targetUnit: 'LOCK-UNIT',
        torqueWrenchId: 'LOCK-WRENCH',
      },
    });
    expect(startRes.statusCode).toBe(200);
    const sessionId = startRes.json().session.id as string;

    const torqueResponses = await Promise.all(Array.from({ length: 2 }, () => app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${sessionId}/record-torque`,
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: { value: 10, source: 'manual' },
    })));
    expect(torqueResponses.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect(torqueResponses.filter((response) => response.statusCode === 409)).toHaveLength(1);
    const torqueRecords = await prisma.assemblyTorqueRecord.findMany({
      where: { sessionId },
      orderBy: { attempt: 'asc' },
    });
    expect(torqueRecords).toHaveLength(1);
    expect(torqueRecords[0]!.attempt).toBe(1);

    const responses = await Promise.all(Array.from({ length: 2 }, () => app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${sessionId}/cancel`,
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: { reason: '同時取消' },
    })));

    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(1);
    expect(responses.find((response) => response.statusCode === 409)!.json().errorCode)
      .toBe('ASSEMBLY_SESSION_STATE_CONFLICT');
    const stored = await prisma.assemblyWorkSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(stored.status).toBe('CANCELLED');
    expect(stored.cancelledAt).not.toBeNull();
  });

  it('共通予算内ならPrisma既定5秒を超える作業セッション行ロックを待機できる', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey };
    const document = await uploadPublishedProcedureDocument(app, headers, '長時間ロック待機手順');
    const templateRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: buildTemplatePayload(document.id, {
        modelCode: 'LOCK-BUDGET',
        procedurePattern: '標準',
        name: '長時間ロック待機テンプレート'
      })
    });
    expect(templateRes.statusCode).toBe(200);

    const startRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: {
        templateId: templateRes.json().template.id,
        productNo: 'LOCK-BUDGET-PRODUCT',
        serialNo: 'LOCK-BUDGET-SERIAL',
        operatorNfcTagUid: directStartOperatorNfcTagUid,
        requestId: randomUUID(),
        targetUnit: 'LOCK-BUDGET-UNIT',
        torqueWrenchId: 'LOCK-BUDGET-WRENCH'
      }
    });
    expect(startRes.statusCode).toBe(200);
    const sessionId = startRes.json().session.id as string;

    let reportLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      reportLocked = resolve;
    });
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "AssemblyWorkSession" WHERE id = ${sessionId} FOR UPDATE
      `;
      reportLocked();
      await tx.$queryRaw<Array<{ slept: string | null }>>`
        SELECT pg_sleep(6)::text AS slept
      `;
    }, { maxWait: 5_000, timeout: 10_000 });
    await locked;

    const startedAt = Date.now();
    const torquePromise = app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${sessionId}/record-torque`,
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: { value: 10, source: 'manual' }
    });
    await blocker;
    const torque = await torquePromise;

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(5_000);
    expect(torque.statusCode).toBe(200);
    expect(torque.json().outcome.kind).toBe('accepted_ok');
  }, 15_000);

  it('runs the MVP flow from procedure upload to Excel export', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey };

    const upload = buildMultipartProcedure('手順7');
    const docRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/procedure-documents',
      headers: { ...headers, 'Content-Type': upload.contentType },
      payload: upload.body
    });
    expect(docRes.statusCode).toBe(200);
    const documentId = docRes.json().document.id as string;
    await publishProcedureDocument(app, headers, documentId);

    const templateRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: {
        modelCode: 'DFL7161',
        procedurePattern: '手順7',
        name: 'DFL7161 手順7',
        procedureDocumentId: documentId,
        areas: [
          {
            sortOrder: 0,
            processNo: '7',
            areaCode: '13',
            areaName: 'ストッパー取付',
            unitCode: 'U1',
            requireManualAdvance: true,
            bolts: [
              {
                sortOrder: 0,
                tighteningId: 'P7-A13-U1-B1',
                markerNo: 1,
                xRatio: 0.25,
                yRatio: 0.25,
                boltSpec: 'M8x16',
                nominalTorque: 10,
                lowerLimit: 9,
                upperLimit: 11,
                unit: 'N-m'
              },
              {
                sortOrder: 1,
                tighteningId: 'P7-A13-U1-B2',
                markerNo: 2,
                xRatio: 0.45,
                yRatio: 0.25,
                boltSpec: 'M8x16',
                nominalTorque: 20,
                lowerLimit: 19,
                upperLimit: 21,
                unit: 'N-m'
              }
            ]
          },
          {
            sortOrder: 1,
            processNo: '7',
            areaCode: '14',
            areaName: 'サドル取付',
            unitCode: 'U2',
            requireManualAdvance: true,
            bolts: [
              {
                sortOrder: 0,
                tighteningId: 'P7-A14-U2-B1',
                markerNo: 3,
                xRatio: 0.6,
                yRatio: 0.6,
                boltSpec: 'M6x45',
                nominalTorque: 30,
                lowerLimit: 29,
                upperLimit: 31,
                unit: 'N-m'
              }
            ]
          }
        ]
      }
    });
    expect(templateRes.statusCode).toBe(200);
    const templateId = templateRes.json().template.id as string;

    const startRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: {
        templateId,
        productNo: 'M-001',
        serialNo: 'S-001',
        nameplateNo: 'NP-001',
        operatorNfcTagUid: directStartOperatorNfcTagUid,
        requestId: randomUUID(),
        targetUnit: 'X軸',
        torqueWrenchId: 'CEM20N3X10D-BTLA'
      }
    });
    expect(startRes.statusCode).toBe(200);
    let session = startRes.json().session;
    expect(session.currentBoltId).toBe(session.template.areas[0].bolts[0].id);

    const firstOk = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${session.id}/record-torque`,
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: { value: 10, source: 'manual' }
    });
    expect(firstOk.statusCode).toBe(200);
    expect(firstOk.json().outcome.kind).toBe('accepted_ok');
    session = firstOk.json().session;
    expect(session.currentBoltId).toBe(session.template.areas[0].bolts[1].id);

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${session.id}/record-torque`,
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: { value: 20, source: 'manual' }
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().outcome.kind).toBe('ignored_duplicate');

    await prisma.assemblyTorqueRecord.updateMany({
      where: { sessionId: session.id, judgement: 'OK' },
      data: { recordedAt: new Date(Date.now() - 2000) }
    });

    const secondOk = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${session.id}/record-torque`,
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: { value: 20, source: 'mock' }
    });
    expect(secondOk.statusCode).toBe(200);
    expect(secondOk.json().outcome.areaCompleted).toBe(true);
    session = secondOk.json().session;
    expect(session.currentBoltId).toBeNull();

    const advanced = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${session.id}/advance-area`,
      headers
    });
    expect(advanced.statusCode).toBe(200);
    session = advanced.json().session;
    expect(session.currentBoltId).toBe(session.template.areas[1].bolts[0].id);

    await prisma.assemblyTorqueRecord.updateMany({
      where: { sessionId: session.id, judgement: 'OK' },
      data: { recordedAt: new Date(Date.now() - 2000) }
    });

    for (let i = 0; i < 3; i += 1) {
      const ng = await app.inject({
        method: 'POST',
        url: `/api/assembly/work-sessions/${session.id}/record-torque`,
        headers: { ...headers, 'Content-Type': 'application/json' },
        payload: { value: 40 + i, source: 'manual' }
      });
      expect(ng.statusCode).toBe(200);
      if (i === 2) {
        expect(ng.json().outcome.requiresAreaRestart).toBe(true);
      }
    }

    const restarted = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${session.id}/restart-area`,
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: { reason: '上限超過確認' }
    });
    expect(restarted.statusCode).toBe(200);
    session = restarted.json().session;
    expect(session.restartLogs).toHaveLength(1);

    const finalOk = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${session.id}/record-torque`,
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: { value: 30, source: 'manual' }
    });
    expect(finalOk.statusCode).toBe(200);
    expect(finalOk.json().outcome.allBoltsCompleted).toBe(true);
    session = finalOk.json().session;

    const complete = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${session.id}/complete`,
      headers,
      payload: {}
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().session.status).toBe('completed');

    const exported = await app.inject({
      method: 'GET',
      url: `/api/assembly/work-sessions/${session.id}/export.xlsx`,
      headers
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(exported.rawPayload.length).toBeGreaterThan(1000);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.rawPayload);
    const summaryRows = workbook.getWorksheet('概要')?.getColumn(1).values ?? [];
    expect(summaryRows).toContain('型番/FHINCD');
  });

  it('round-trips optional bolt/check callouts, copies them on revision, and rejects invalid pairs', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey, 'Content-Type': 'application/json' };
    const document = await uploadPublishedProcedureDocument(app, headers, '矢視付き手順書');
    const base = buildTemplatePayload(document.id, {
      modelCode: 'CALLOUT-01',
      procedurePattern: '標準',
      name: '矢視付きテンプレート'
    });
    const payload = {
      ...base,
      areas: base.areas.map((area) => ({
        ...area,
        bolts: area.bolts.map((bolt) => ({
          ...bolt,
          calloutTipXRatio: 0.82,
          calloutTipYRatio: 0.18
        }))
      })),
      checkItems: [
        {
          markerNo: 1,
          label: '目視確認',
          required: true,
          xRatio: 0.4,
          yRatio: 0.5,
          calloutTipXRatio: 0.12,
          calloutTipYRatio: 0.88,
          sortOrder: 0,
          assemblyProcedureDocumentId: document.id,
          pageIndex: 0
        }
      ]
    };

    const created = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload
    });
    expect(created.statusCode).toBe(200);
    const template = created.json().template;
    expect(Number(template.areas[0].bolts[0].calloutTipXRatio)).toBeCloseTo(0.82);
    expect(Number(template.areas[0].bolts[0].calloutTipYRatio)).toBeCloseTo(0.18);
    expect(template.checkItems[0]).toMatchObject({
      calloutTipXRatio: 0.12,
      calloutTipYRatio: 0.88
    });

    const revised = await app.inject({
      method: 'POST',
      url: `/api/assembly/templates/${template.id}/revise`,
      headers,
      payload: { name: '矢視コピー確認' }
    });
    expect(revised.statusCode).toBe(200);
    const revisedTemplate = revised.json().template;
    expect(Number(revisedTemplate.areas[0].bolts[0].calloutTipXRatio)).toBeCloseTo(0.82);
    expect(revisedTemplate.checkItems[0].calloutTipYRatio).toBeCloseTo(0.88);

    const sessionRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers,
      payload: {
        templateId: revisedTemplate.id,
        productNo: 'CALLOUT-PRODUCT',
        serialNo: 'CALLOUT-SERIAL',
        operatorNfcTagUid: directStartOperatorNfcTagUid,
        requestId: randomUUID(),
        targetUnit: 'CALLOUT-01',
        torqueWrenchId: 'CALLOUT-WRENCH'
      }
    });
    expect(sessionRes.statusCode).toBe(200);
    expect(Number(sessionRes.json().session.template.areas[0].bolts[0].calloutTipXRatio)).toBeCloseTo(0.82);
    expect(sessionRes.json().session.checkItems[0]).toMatchObject({
      calloutTipXRatio: 0.12,
      calloutTipYRatio: 0.88
    });

    const invalidPairPayload = structuredClone(payload);
    delete invalidPairPayload.areas[0]!.bolts[0]!.calloutTipYRatio;
    const invalidPair = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload: invalidPairPayload
    });
    expect(invalidPair.statusCode).toBe(400);

    const mixedNullPayload = structuredClone(payload);
    mixedNullPayload.checkItems[0]!.calloutTipXRatio = null as unknown as number;
    delete mixedNullPayload.checkItems[0]!.calloutTipYRatio;
    const mixedNull = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload: mixedNullPayload
    });
    expect(mixedNull.statusCode).toBe(400);

    const outOfRangePayload = structuredClone(payload);
    outOfRangePayload.checkItems[0]!.calloutTipXRatio = 1.01;
    const outOfRange = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload: outOfRangePayload
    });
    expect(outOfRange.statusCode).toBe(400);

    const nonFiniteJson = JSON.stringify(payload).replace(
      '"calloutTipXRatio":0.82',
      '"calloutTipXRatio":1e400'
    );
    const nonFinite = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload: nonFiniteJson
    });
    expect(nonFinite.statusCode).toBe(400);

    const explicitNullPayload = structuredClone(payload);
    explicitNullPayload.areas[0]!.bolts[0]!.calloutTipXRatio = null as unknown as number;
    explicitNullPayload.areas[0]!.bolts[0]!.calloutTipYRatio = null as unknown as number;
    const explicitNull = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload: explicitNullPayload
    });
    expect(explicitNull.statusCode).toBe(200);
    expect(explicitNull.json().template.areas[0].bolts[0].calloutTipXRatio).toBeNull();
  });

  it('returns procedure and template summaries for library management', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey };

    const uploadA = buildMultipartProcedure('ストッパー取付 手順書');
    const docARes = await app.inject({
      method: 'POST',
      url: '/api/assembly/procedure-documents',
      headers: { ...headers, 'Content-Type': uploadA.contentType },
      payload: uploadA.body
    });
    expect(docARes.statusCode).toBe(200);
    const documentAId = docARes.json().document.id as string;
    await publishProcedureDocument(app, headers, documentAId);

    const firstTemplate = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: buildTemplatePayload(documentAId, { modelCode: 'FH-20A', procedurePattern: '手順7', name: 'FH-20A v1' })
    });
    expect(firstTemplate.statusCode).toBe(200);

    const secondTemplate = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: buildTemplatePayload(documentAId, { modelCode: 'FH-20A', procedurePattern: '手順7', name: 'FH-20A v2' })
    });
    expect(secondTemplate.statusCode).toBe(200);

    const procedureSummary = await app.inject({
      method: 'GET',
      url: '/api/assembly/procedure-documents/summary?q=ストッパー',
      headers
    });
    expect(procedureSummary.statusCode).toBe(200);
    const docSummary = procedureSummary.json().documents[0];
    expect(docSummary.id).toBe(documentAId);
    expect(docSummary.activeTemplateCount).toBe(1);
    expect(docSummary.totalTemplateCount).toBe(2);

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/assembly/procedure-documents/${documentAId}`,
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: { name: '変更後 手順書' }
    });
    expect(renamed.statusCode).toBe(200);

    const templateSummary = await app.inject({
      method: 'GET',
      url: '/api/assembly/templates/summary?modelCode=FH-20A&procedurePattern=%E6%89%8B%E9%A0%867&includeInactive=true',
      headers
    });
    expect(templateSummary.statusCode).toBe(200);
    const templates = templateSummary.json().templates;
    expect(templates).toHaveLength(2);
    expect(templates[0]).toMatchObject({
      modelCode: 'FH-20A',
      procedurePattern: '手順7',
      procedureDocumentName: '変更後 手順書',
      areaCount: 1,
      boltCount: 1,
      isActive: true
    });
    expect(templates[1]).toMatchObject({ isActive: false });

    const byProcedureName = await app.inject({
      method: 'GET',
      url: '/api/assembly/templates/summary?procedureDocumentName=%E5%A4%89%E6%9B%B4%E5%BE%8C&includeInactive=true',
      headers
    });
    expect(byProcedureName.statusCode).toBe(200);
    expect(byProcedureName.json().templates).toHaveLength(2);

    const inUseDelete = await app.inject({
      method: 'DELETE',
      url: `/api/assembly/procedure-documents/${documentAId}`,
      headers
    });
    expect(inUseDelete.statusCode).toBe(409);

    const stillActiveProcedureSummary = await app.inject({
      method: 'GET',
      url: '/api/assembly/procedure-documents/summary?q=%E5%A4%89%E6%9B%B4%E5%BE%8C&includeInactive=true',
      headers
    });
    expect(stillActiveProcedureSummary.statusCode).toBe(200);
    expect(stillActiveProcedureSummary.json().documents[0]).toMatchObject({
      id: documentAId,
      isActive: true,
      activeTemplateCount: 1,
      totalTemplateCount: 2
    });

    const uploadUnused = buildMultipartProcedure('未使用 手順書');
    const unusedDocRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/procedure-documents',
      headers: { ...headers, 'Content-Type': uploadUnused.contentType },
      payload: uploadUnused.body
    });
    expect(unusedDocRes.statusCode).toBe(200);
    const unusedDocumentId = unusedDocRes.json().document.id as string;
    const unusedImagePath = unusedDocRes.json().document.imageRelativePath as string;

    const imageBeforeDelete = await app.inject({
      method: 'GET',
      url: unusedImagePath,
      headers
    });
    expect(imageBeforeDelete.statusCode).toBe(200);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/assembly/procedure-documents/${unusedDocumentId}`,
      headers
    });
    expect(deleted.statusCode).toBe(204);

    const deletedLookup = await app.inject({
      method: 'GET',
      url: `/api/assembly/procedure-documents/${unusedDocumentId}`,
      headers
    });
    expect(deletedLookup.statusCode).toBe(404);

    const imageAfterDelete = await app.inject({
      method: 'GET',
      url: unusedImagePath,
      headers
    });
    expect(imageAfterDelete.statusCode).toBe(404);
  });

  it('returns complete, pane-scoped, case-insensitive library filter options', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey, 'Content-Type': 'application/json' };
    const alpha = await uploadPublishedProcedureDocument(app, headers, 'Alpha Manual');
    const alphaCaseVariant = await uploadPublishedProcedureDocument(app, headers, 'alpha manual');
    const inactiveDocument = await uploadPublishedProcedureDocument(app, headers, 'Inactive Procedure Only');

    const activeA = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload: buildTemplatePayload(alpha.id, {
        modelCode: 'FILTER-X',
        procedurePattern: '標準',
        name: 'Filter active A'
      })
    });
    expect(activeA.statusCode).toBe(200);
    const activeCaseVariant = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload: buildTemplatePayload(alphaCaseVariant.id, {
        modelCode: 'filter-x',
        procedurePattern: '別手順',
        name: 'Filter active B'
      })
    });
    expect(activeCaseVariant.statusCode).toBe(200);
    const inactiveTemplate = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload: buildTemplatePayload(inactiveDocument.id, {
        modelCode: 'INACTIVE-ONLY',
        procedurePattern: '標準',
        name: 'Inactive filter template'
      })
    });
    expect(inactiveTemplate.statusCode).toBe(200);
    const retired = await app.inject({
      method: 'DELETE',
      url: `/api/assembly/templates/${inactiveTemplate.json().template.id}`,
      headers: { 'x-client-key': client.apiKey }
    });
    expect(retired.statusCode).toBe(204);
    await prisma.assemblyProcedureDocument.update({
      where: { id: inactiveDocument.id },
      data: { isActive: false }
    });
    await prisma.assemblyTemplate.createMany({
      data: Array.from({ length: 205 }, (_, index) => ({
        modelCode: `TAIL-${String(index).padStart(3, '0')}`,
        procedurePattern: '候補全件確認',
        name: `候補全件確認 ${index}`,
        procedureDocumentId: alpha.id
      }))
    });

    const modelOptions = await app.inject({
      method: 'GET',
      url: '/api/assembly/library/filter-options?field=templateModelCode&q=filter',
      headers
    });
    expect(modelOptions.statusCode).toBe(200);
    expect(modelOptions.json().options).toHaveLength(1);
    expect(modelOptions.json().options[0].toLowerCase()).toBe('filter-x');

    const beyondSummaryLimit = await app.inject({
      method: 'GET',
      url: '/api/assembly/library/filter-options?field=templateModelCode&q=TAIL-204',
      headers
    });
    expect(beyondSummaryLimit.statusCode).toBe(200);
    expect(beyondSummaryLimit.json().options).toEqual(['TAIL-204']);

    const inactiveModels = await app.inject({
      method: 'GET',
      url: '/api/assembly/library/filter-options?field=templateModelCode&includeInactive=true',
      headers
    });
    expect(inactiveModels.statusCode).toBe(200);
    expect(inactiveModels.json().options).toContain('INACTIVE-ONLY');

    const templateDocumentOptions = await app.inject({
      method: 'GET',
      url: '/api/assembly/library/filter-options?field=templateProcedureDocumentName&q=manual',
      headers
    });
    expect(templateDocumentOptions.statusCode).toBe(200);
    expect(templateDocumentOptions.json().options).toHaveLength(1);

    const procedureOptions = await app.inject({
      method: 'GET',
      url: '/api/assembly/library/filter-options?field=procedureDocumentName',
      headers
    });
    expect(procedureOptions.statusCode).toBe(200);
    expect(procedureOptions.json().options).not.toContain('Inactive Procedure Only');

    const procedureOptionsWithInactiveFlag = await app.inject({
      method: 'GET',
      url: '/api/assembly/library/filter-options?field=procedureDocumentName&includeInactive=true',
      headers
    });
    expect(procedureOptionsWithInactiveFlag.statusCode).toBe(200);
    expect(procedureOptionsWithInactiveFlag.json().options).not.toContain('Inactive Procedure Only');

    const limited = await app.inject({
      method: 'GET',
      url: '/api/assembly/library/filter-options?field=procedureDocumentName&limit=1',
      headers
    });
    expect(limited.statusCode).toBe(200);
    expect(limited.json().options).toHaveLength(1);

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/assembly/procedure-documents/${alpha.id}`,
      headers,
      payload: { name: 'Renamed Assembly Manual' }
    });
    expect(renamed.statusCode).toBe(200);
    const renamedOptions = await app.inject({
      method: 'GET',
      url: '/api/assembly/library/filter-options?field=templateProcedureDocumentName&q=renamed',
      headers
    });
    expect(renamedOptions.statusCode).toBe(200);
    expect(renamedOptions.json().options).toEqual(['Renamed Assembly Manual']);
  });

  it('searches assembly seiban candidates with machine names and active template match', async () => {
    await ensureProductionScheduleDashboard();
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey };

    const upload = buildMultipartProcedure('ASMTEST 手順書');
    const docRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/procedure-documents',
      headers: { ...headers, 'Content-Type': upload.contentType },
      payload: upload.body
    });
    expect(docRes.statusCode).toBe(200);
    const documentId = docRes.json().document.id as string;
    await publishProcedureDocument(app, headers, documentId);

    const templateRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: buildTemplatePayload(documentId, { modelCode: 'MH-AX', procedurePattern: '標準', name: 'MH-AX 標準' })
    });
    expect(templateRes.statusCode).toBe(200);
    const activeTemplateId = templateRes.json().template.id;

    await createScheduleRow({
      FSEIBAN: 'ASMTEST-A1',
      FHINCD: 'MH001',
      FHINMEI: 'ｍｈ－ａｘ',
      FSIGENCD: 'R1',
      FKOJUN: '1',
      ProductNo: '1'
    });
    await createScheduleRow({
      FSEIBAN: 'ASMTEST-B2',
      FHINCD: 'P001',
      FHINMEI: '部品',
      FSIGENCD: 'R2',
      FKOJUN: '1',
      ProductNo: '1'
    });
    await createScheduleRow({
      FSEIBAN: 'ASMTEST-C3',
      FHINCD: 'P002',
      FHINMEI: '部品',
      FSIGENCD: 'R3',
      FKOJUN: '1',
      ProductNo: '1'
    });
    await prisma.productionScheduleSeibanMachineNameSupplement.create({
      data: {
        sourceCsvDashboardId: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
        fseiban: 'ASMTEST-B2',
        machineName: 'ｓｕｐｐ－ｚ'
      }
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/assembly/seiban-candidates?prefix=asmtest&limit=10',
      headers
    });
    expect(res.statusCode).toBe(200);
    const candidates = res.json().candidates;
    expect(candidates).toHaveLength(3);
    expect(candidates[0]).toMatchObject({
      fseiban: 'ASMTEST-A1',
      machineName: 'MH-AX',
      machineNameSource: 'production_schedule',
      activeTemplate: { id: activeTemplateId, name: 'MH-AX 標準' }
    });
    expect(candidates[1]).toMatchObject({
      fseiban: 'ASMTEST-B2',
      machineName: 'SUPP-Z',
      machineNameSource: 'supplement',
      activeTemplate: null
    });
    expect(candidates[2]).toMatchObject({
      fseiban: 'ASMTEST-C3',
      machineName: SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL,
      machineNameSource: 'unregistered',
      activeTemplate: null
    });
  });

  it('lists authenticated assembly machine-name candidates from winner and supplement data', async () => {
    await ensureProductionScheduleDashboard();
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey };

    await createScheduleRow({
      FSEIBAN: 'ASMTEST-MACHINE-1',
      FHINCD: 'MH001',
      FHINMEI: 'Ｌ３００ＫＰ－２',
      FSIGENCD: 'R1',
      FKOJUN: '1',
      ProductNo: '1'
    });
    await prisma.productionScheduleSeibanMachineNameSupplement.create({
      data: {
        sourceCsvDashboardId: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
        fseiban: 'ASMTEST-MACHINE-2',
        machineName: 'L300KP-10'
      }
    });
    resetMachineNameFseibanMatchCaches();

    const unauthorized = await app.inject({
      method: 'GET',
      url: '/api/assembly/machine-name-candidates?digitQuery=300&q=kp'
    });
    expect(unauthorized.statusCode).toBe(401);

    const invalid = await app.inject({
      method: 'GET',
      url: '/api/assembly/machine-name-candidates?digitQuery=30A',
      headers
    });
    expect(invalid.statusCode).toBe(400);

    const response = await app.inject({
      method: 'GET',
      url: '/api/assembly/machine-name-candidates?digitQuery=300&q=kp&limit=40',
      headers
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      candidates: ['Ｌ３００ＫＰ－２', 'L300KP-10'],
      hasMore: false
    });

    await prisma.productionScheduleSeibanMachineNameSupplement.createMany({
      data: Array.from({ length: 41 }, (_, index) => ({
        sourceCsvDashboardId: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
        fseiban: `ASMTEST-CAP-${index + 1}`,
        machineName: `CAPMODEL-${index + 1}`
      }))
    });
    resetMachineNameFseibanMatchCaches();
    const limited = await app.inject({
      method: 'GET',
      url: '/api/assembly/machine-name-candidates?q=capmodel&limit=40',
      headers
    });
    expect(limited.statusCode).toBe(200);
    expect(limited.json().candidates).toHaveLength(40);
    expect(limited.json().candidates.slice(0, 3)).toEqual(['CAPMODEL-1', 'CAPMODEL-2', 'CAPMODEL-3']);
    expect(limited.json().hasMore).toBe(true);
  });

  it('resumes in-progress work by seiban and serial and lists in-progress summaries', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey };

    const upload = buildMultipartProcedure('開始 手順書');
    const docRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/procedure-documents',
      headers: { ...headers, 'Content-Type': upload.contentType },
      payload: upload.body
    });
    expect(docRes.statusCode).toBe(200);
    const documentId = docRes.json().document.id as string;
    await publishProcedureDocument(app, headers, documentId);

    const templateRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: buildTemplatePayload(documentId, { modelCode: 'MACHINE-X', procedurePattern: '標準', name: 'MACHINE-X 標準' })
    });
    expect(templateRes.statusCode).toBe(200);
    const templateId = templateRes.json().template.id as string;

    const startPayload = {
      templateId,
      productNo: 'ａｓｍ-start-001',
      serialNo: 's001',
      operatorNfcTagUid: directStartOperatorNfcTagUid,
      requestId: randomUUID(),
      targetUnit: 'machine-x',
      torqueWrenchId: 'CEM20N3X10D-BTLA'
    };
    const firstStart = await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: startPayload
    });
    expect(firstStart.statusCode).toBe(200);
    const firstSession = firstStart.json().session;
    expect(firstSession.productNo).toBe('ASM-START-001');
    expect(firstSession.serialNo).toBe('S001');
    expect(firstSession.nameplateNo).toBe('S001');
    expect(firstSession.targetUnit).toBe('MACHINE-X');

    const duplicateStart = await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: startPayload
    });
    expect(duplicateStart.statusCode).toBe(200);
    expect(duplicateStart.json().session.id).toBe(firstSession.id);

    const secondSerialStart = await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: { ...startPayload, serialNo: 'S002', requestId: randomUUID() }
    });
    expect(secondSerialStart.statusCode).toBe(200);
    const secondSession = secondSerialStart.json().session;
    expect(secondSession.id).not.toBe(firstSession.id);

    const summaryBeforeCancel = await app.inject({
      method: 'GET',
      url: '/api/assembly/work-sessions/summary?status=in_progress&productNo=asm-start-001',
      headers
    });
    expect(summaryBeforeCancel.statusCode).toBe(200);
    expect(summaryBeforeCancel.json().sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstSession.id,
          productNo: 'ASM-START-001',
          serialNo: 'S001',
          targetUnit: 'MACHINE-X',
          acceptedBoltCount: 0,
          totalBoltCount: 1,
          currentAreaName: 'ストッパー取付',
          currentBoltMarkerNo: 1
        }),
        expect.objectContaining({
          id: secondSession.id,
          serialNo: 'S002'
        })
      ])
    );

    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${firstSession.id}/cancel`,
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: { reason: 'test' }
    });
    expect(cancelled.statusCode).toBe(200);

    const summaryAfterCancel = await app.inject({
      method: 'GET',
      url: '/api/assembly/work-sessions/summary?status=in_progress&productNo=ASM-START-001',
      headers
    });
    expect(summaryAfterCancel.statusCode).toBe(200);
    const remainingIds = summaryAfterCancel.json().sessions.map((session: { id: string }) => session.id);
    expect(remainingIds).not.toContain(firstSession.id);
    expect(remainingIds).toContain(secondSession.id);

    const cancelledSerialRestart = await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: { ...startPayload, requestId: randomUUID() }
    });
    expect(cancelledSerialRestart.statusCode).toBe(409);
  });

  it('registers an assembly lot, starts serial work lazily, and updates lot completion counts', async () => {
    const client = await createTestClientDevice();
    const approver = await createTestEmployee({ displayName: '承認者' });
    const headers = { 'x-client-key': client.apiKey, 'Content-Type': 'application/json' };

    const upload = buildMultipartProcedure('ロット 手順書');
    const docRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/procedure-documents',
      headers: { 'x-client-key': client.apiKey, 'Content-Type': upload.contentType },
      payload: upload.body
    });
    expect(docRes.statusCode).toBe(200);
    await publishProcedureDocument(app, { 'x-client-key': client.apiKey }, docRes.json().document.id as string);

    const templateRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload: buildTemplatePayload(docRes.json().document.id, {
        modelCode: 'MACHINE-LOT',
        procedurePattern: '標準',
        name: 'MACHINE-LOT 標準'
      })
    });
    expect(templateRes.statusCode).toBe(200);
    const templateId = templateRes.json().template.id as string;

    const shortLot = await app.inject({
      method: 'POST',
      url: '/api/assembly/lots',
      headers,
      payload: {
        templateId,
        productNo: 'ASM-LOT-001',
        expectedQuantity: 2,
        serialNos: ['LOT001'],
        operatorNameSnapshot: '佐藤',
        targetUnit: 'machine-lot',
        torqueWrenchId: 'CEM20N3X10D-BTLA'
      }
    });
    expect(shortLot.statusCode).toBe(400);

    const duplicateInPayload = await app.inject({
      method: 'POST',
      url: '/api/assembly/lots',
      headers,
      payload: {
        templateId,
        productNo: 'ASM-LOT-001',
        expectedQuantity: 2,
        serialNos: ['LOT001', 'lot001'],
        operatorNameSnapshot: '佐藤',
        targetUnit: 'machine-lot',
        torqueWrenchId: 'CEM20N3X10D-BTLA'
      }
    });
    expect(duplicateInPayload.statusCode).toBe(400);

    const lotRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/lots',
      headers,
      payload: {
        templateId,
        productNo: 'asm-lot-001',
        expectedQuantity: 2,
        serialNos: ['lot001', 'lot002'],
        operatorNameSnapshot: '佐藤',
        targetUnit: 'machine-lot',
        torqueWrenchId: 'CEM20N3X10D-BTLA'
      }
    });
    expect(lotRes.statusCode).toBe(200);
    const lot = lotRes.json().lot;
    expect(lot).toMatchObject({
      productNo: 'ASM-LOT-001',
      expectedQuantity: 2,
      registeredSerialCount: 2,
      notStartedCount: 2,
      inProgressCount: 0,
      completedCount: 0,
      approvedCount: 0,
      isWorkComplete: false,
      isFullyApproved: false
    });
    expect(lot.serials.map((serial: { serialNo: string; status: string }) => [serial.serialNo, serial.status])).toEqual([
      ['LOT001', 'not_started'],
      ['LOT002', 'not_started']
    ]);
    expect(await prisma.assemblyWorkSession.count()).toBe(0);

    const duplicateExisting = await app.inject({
      method: 'POST',
      url: '/api/assembly/lots',
      headers,
      payload: {
        templateId,
        productNo: 'ASM-LOT-002',
        expectedQuantity: 1,
        serialNos: ['LOT001'],
        operatorNameSnapshot: '佐藤',
        targetUnit: 'machine-lot',
        torqueWrenchId: 'CEM20N3X10D-BTLA'
      }
    });
    expect(duplicateExisting.statusCode).toBe(409);

    const firstSerial = lot.serials[0];
    const startRequestId = randomUUID();
    const start = await app.inject({
      method: 'POST',
      url: `/api/assembly/lots/${lot.id}/serials/${firstSerial.id}/start`,
      headers,
      payload: {
        operatorNfcTagUid: approver.nfcTagUid,
        requestId: startRequestId
      }
    });
    expect(start.statusCode).toBe(200);
    const session = start.json().session;
    expect(session).toMatchObject({
      lotSerialId: firstSerial.id,
      productNo: 'ASM-LOT-001',
      serialNo: 'LOT001',
      targetUnit: 'MACHINE-LOT'
    });
    expect(await prisma.assemblyWorkSession.count()).toBe(1);

    const restart = await app.inject({
      method: 'POST',
      url: `/api/assembly/lots/${lot.id}/serials/${firstSerial.id}/start`,
      headers,
      payload: {
        operatorNfcTagUid: approver.nfcTagUid,
        requestId: startRequestId
      }
    });
    expect(restart.statusCode).toBe(200);
    expect(restart.json().session.id).toBe(session.id);
    expect(await prisma.assemblyWorkSession.count()).toBe(1);

    const torque = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${session.id}/record-torque`,
      headers,
      payload: { value: 10, source: 'manual' }
    });
    expect(torque.statusCode).toBe(200);

    const complete = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${session.id}/complete`,
      headers,
      payload: {}
    });
    expect(complete.statusCode).toBe(200);

    const summaryAfterComplete = await app.inject({
      method: 'GET',
      url: `/api/assembly/lots/${lot.id}`,
      headers
    });
    expect(summaryAfterComplete.statusCode).toBe(200);
    expect(summaryAfterComplete.json().lot).toMatchObject({
      completedCount: 1,
      approvedCount: 0,
      isWorkComplete: false,
      isFullyApproved: false
    });

    const approve = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${session.id}/record-approval/approve`,
      headers,
      payload: { approverEmployeeTagUid: approver.nfcTagUid }
    });
    expect(approve.statusCode).toBe(200);

    const summaryAfterApprove = await app.inject({
      method: 'GET',
      url: '/api/assembly/lots/summary?productNo=ASM-LOT-001',
      headers
    });
    expect(summaryAfterApprove.statusCode).toBe(200);
    expect(summaryAfterApprove.json().lots[0]).toMatchObject({
      completedCount: 1,
      approvedCount: 1,
      isWorkComplete: false,
      isFullyApproved: false
    });
  });

  it('auto-issues normalized work IDs, serializes same-product registration, and permanently reserves invalidated IDs', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey, 'Content-Type': 'application/json' };
    const publishedDoc = await uploadPublishedProcedureDocument(app, headers, '自動採番手順');
    const templateRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload: buildTemplatePayload(publishedDoc.id, {
        modelCode: 'AUTO-ID',
        procedurePattern: '自動'
      })
    });
    expect(templateRes.statusCode).toBe(200);
    const templateId = templateRes.json().template.id as string;

    const createAutoLot = (productNo: string, expectedQuantity: number) =>
      app.inject({
        method: 'POST',
        url: '/api/assembly/lots',
        headers,
        payload: {
          templateId,
          productNo,
          expectedQuantity,
          workIdMode: 'auto',
          targetUnit: 'auto-machine',
          torqueWrenchId: 'CEM20N3X10D-BTLA'
        }
      });

    const autoLotRes = await createAutoLot('ａｕｔｏ－ｌｏｔ', 3);
    expect(autoLotRes.statusCode).toBe(200);
    const autoLot = autoLotRes.json().lot;
    expect(autoLot.operatorNameSnapshot).toBeNull();
    expect(
      await prisma.assemblyLot.findUniqueOrThrow({
        where: { id: autoLot.id as string },
        select: { operatorNameSnapshot: true }
      })
    ).toEqual({ operatorNameSnapshot: '' });
    expect(
      autoLot.serials.map((serial: { workId: string }) => serial.workId)
    ).toEqual(['AUTO-LOT-001', 'AUTO-LOT-002', 'AUTO-LOT-003']);

    const tooLong = await createAutoLot('A'.repeat(117), 1);
    expect(tooLong.statusCode).toBe(400);

    const concurrent = await Promise.all([
      createAutoLot('AUTO-RACE', 1),
      createAutoLot('auto-race', 1)
    ]);
    expect(concurrent.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(await prisma.assemblyLot.count({ where: { productNo: 'AUTO-RACE' } })).toBe(1);

    const firstSerial = autoLot.serials[0] as { workUnitId: string; workId: string };
    const invalidationRequestId = randomUUID();
    const wrongPassword = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-units/${firstSerial.workUnitId}/invalidate`,
      headers,
      payload: {
        accessPassword: '0000',
        reason: '誤登録',
        requestId: randomUUID()
      }
    });
    expect(wrongPassword.statusCode).toBe(403);

    const firstInvalidation = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-units/${firstSerial.workUnitId}/invalidate`,
      headers,
      payload: {
        accessPassword: '2520',
        reason: '誤登録',
        requestId: invalidationRequestId
      }
    });
    expect(firstInvalidation.statusCode).toBe(200);
    expect(firstInvalidation.json().invalidation).toMatchObject({
      workId: 'AUTO-LOT-001',
      sourceState: 'not_started',
      reason: '誤登録'
    });
    const idempotentInvalidation = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-units/${firstSerial.workUnitId}/invalidate`,
      headers,
      payload: {
        accessPassword: '2520',
        reason: '誤登録',
        requestId: invalidationRequestId
      }
    });
    expect(idempotentInvalidation.statusCode).toBe(200);
    expect(idempotentInvalidation.json().invalidation.id).toBe(
      firstInvalidation.json().invalidation.id
    );

    for (const serial of autoLot.serials.slice(1) as Array<{ workUnitId: string }>) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/assembly/work-units/${serial.workUnitId}/invalidate`,
        headers,
        payload: {
          accessPassword: '2520',
          reason: 'ロット登録取消',
          requestId: randomUUID()
        }
      });
      expect(response.statusCode).toBe(200);
    }

    const summary = await app.inject({
      method: 'GET',
      url: '/api/assembly/lots/summary?productNo=AUTO-LOT',
      headers
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().lots).toEqual([]);

    const directLookup = await app.inject({
      method: 'POST',
      url: '/api/assembly/traceability/work-units/resolve',
      headers,
      payload: { workId: firstSerial.workId }
    });
    expect(directLookup.statusCode).toBe(200);
    expect(directLookup.json().workUnit.invalidation).toMatchObject({
      reason: '誤登録',
      sourceState: 'not_started'
    });
    expect((await createAutoLot('AUTO-LOT', 1)).statusCode).toBe(409);
  });

  it('requires ACTIVE NFC for start/resume, records idempotent access history, and cancels WIP on invalidation', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey, 'Content-Type': 'application/json' };
    const firstOperator = await createTestEmployee({ displayName: '開始作業者' });
    const resumedOperator = await createTestEmployee({ displayName: '再開作業者' });
    const inactiveOperator = await createTestEmployee({ displayName: '停止作業者' });
    await prisma.employee.update({
      where: { id: inactiveOperator.id },
      data: { status: 'INACTIVE' }
    });
    const publishedDoc = await uploadPublishedProcedureDocument(app, headers, 'NFCゲート手順');
    const templateRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload: buildTemplatePayload(publishedDoc.id, {
        modelCode: 'NFC-GATE',
        procedurePattern: 'NFC'
      })
    });
    const templateId = templateRes.json().template.id as string;
    const directStartPayload = {
      templateId,
      productNo: 'NFC-DIRECT-LOT',
      workId: 'NFC-DIRECT-LOT-001',
      targetUnit: 'NFC機',
      torqueWrenchId: 'CEM20N3X10D-BTLA'
    };
    expect((await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers,
      payload: directStartPayload
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers,
      payload: {
        ...directStartPayload,
        operatorNfcTagUid: 'UNKNOWN-DIRECT-TAG',
        requestId: randomUUID()
      }
    })).statusCode).toBe(404);
    expect((await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers,
      payload: {
        ...directStartPayload,
        operatorNfcTagUid: inactiveOperator.nfcTagUid,
        requestId: randomUUID()
      }
    })).statusCode).toBe(403);
    const directStartRequestId = randomUUID();
    const directStart = await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers,
      payload: {
        ...directStartPayload,
        operatorNfcTagUid: firstOperator.nfcTagUid,
        requestId: directStartRequestId,
        operatorNameSnapshot: '偽装した作業者名'
      }
    });
    expect(directStart.statusCode).toBe(200);
    expect(directStart.json().session.operatorNameSnapshot).toBe('開始作業者');
    expect(await prisma.assemblyWorkSessionOperatorAccess.findUnique({
      where: { requestId: directStartRequestId },
      select: { accessType: true, employeeId: true }
    })).toEqual({
      accessType: 'START',
      employeeId: firstOperator.id
    });
    const directRetry = await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers,
      payload: {
        ...directStartPayload,
        operatorNfcTagUid: firstOperator.nfcTagUid,
        requestId: directStartRequestId
      }
    });
    expect(directRetry.statusCode).toBe(200);
    expect(directRetry.json().session.id).toBe(directStart.json().session.id);
    expect((await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers,
      payload: {
        ...directStartPayload,
        productNo: 'NFC-DIRECT-ALTERED',
        operatorNfcTagUid: firstOperator.nfcTagUid,
        requestId: directStartRequestId
      }
    })).statusCode).toBe(409);
    expect((await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers,
      payload: {
        ...directStartPayload,
        operatorNfcTagUid: firstOperator.nfcTagUid,
        requestId: randomUUID()
      }
    })).statusCode).toBe(409);
    const directRacePayload = {
      ...directStartPayload,
      workId: 'NFC-DIRECT-RACE-001',
      operatorNfcTagUid: firstOperator.nfcTagUid
    };
    const directRace = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/assembly/work-sessions',
        headers,
        payload: { ...directRacePayload, requestId: randomUUID() }
      }),
      app.inject({
        method: 'POST',
        url: '/api/assembly/work-sessions',
        headers,
        payload: { ...directRacePayload, requestId: randomUUID() }
      })
    ]);
    expect(directRace.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect(directRace.filter((response) => response.statusCode === 409)).toHaveLength(1);
    const directRaceSession = await prisma.assemblyWorkSession.findFirstOrThrow({
      where: { workId: directRacePayload.workId }
    });
    expect(await prisma.assemblyWorkSessionOperatorAccess.count({
      where: { sessionId: directRaceSession.id, accessType: 'START' }
    })).toBe(1);
    await prisma.assemblyWorkUnit.create({
      data: {
        workId: 'NFC-DIRECT-INVALIDATED-001',
        invalidatedAt: new Date()
      }
    });
    expect((await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers,
      payload: {
        ...directStartPayload,
        workId: 'NFC-DIRECT-INVALIDATED-001',
        operatorNfcTagUid: firstOperator.nfcTagUid,
        requestId: randomUUID()
      }
    })).statusCode).toBe(409);

    const lotRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/lots',
      headers,
      payload: {
        templateId,
        productNo: 'NFC-GATE-LOT',
        expectedQuantity: 1,
        workIdMode: 'auto',
        targetUnit: 'NFC機',
        torqueWrenchId: 'CEM20N3X10D-BTLA'
      }
    });
    expect(lotRes.statusCode).toBe(200);
    const lot = lotRes.json().lot;
    const serial = lot.serials[0] as {
      id: string;
      workUnitId: string;
      workId: string;
    };
    const startUrl = `/api/assembly/lots/${lot.id}/serials/${serial.id}/start`;

    expect((await app.inject({
      method: 'POST',
      url: startUrl,
      headers,
      payload: { operatorNfcTagUid: 'UNKNOWN-TAG', requestId: randomUUID() }
    })).statusCode).toBe(404);
    expect((await app.inject({
      method: 'POST',
      url: startUrl,
      headers,
      payload: { operatorNfcTagUid: inactiveOperator.nfcTagUid, requestId: randomUUID() }
    })).statusCode).toBe(403);

    const startRequestId = randomUUID();
    const start = await app.inject({
      method: 'POST',
      url: startUrl,
      headers,
      payload: {
        operatorNfcTagUid: firstOperator.nfcTagUid,
        requestId: startRequestId
      }
    });
    expect(start.statusCode).toBe(200);
    expect(start.json().session.operatorNameSnapshot).toBe('開始作業者');
    const sessionId = start.json().session.id as string;
    const retry = await app.inject({
      method: 'POST',
      url: startUrl,
      headers,
      payload: {
        operatorNfcTagUid: firstOperator.nfcTagUid,
        requestId: startRequestId
      }
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().session.id).toBe(sessionId);

    const resumeRequestId = randomUUID();
    const resume = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${sessionId}/operator-access`,
      headers,
      payload: {
        operatorNfcTagUid: resumedOperator.nfcTagUid,
        requestId: resumeRequestId
      }
    });
    expect(resume.statusCode).toBe(200);
    expect(resume.json().session.operatorNameSnapshot).toBe('再開作業者');
    const resumeRetry = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${sessionId}/operator-access`,
      headers,
      payload: {
        operatorNfcTagUid: resumedOperator.nfcTagUid,
        requestId: resumeRequestId
      }
    });
    expect(resumeRetry.statusCode).toBe(200);
    expect(resumeRetry.json().session.id).toBe(sessionId);
    expect(await prisma.assemblyWorkSessionOperatorAccess.count({
      where: { sessionId }
    })).toBe(2);
    expect((await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${sessionId}/operator-access`,
      headers,
      payload: {
        operatorNfcTagUid: inactiveOperator.nfcTagUid,
        requestId: randomUUID()
      }
    })).statusCode).toBe(403);

    const invalidate = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-units/${serial.workUnitId}/invalidate`,
      headers,
      payload: {
        accessPassword: '2520',
        reason: '仕掛品の作業取消',
        requestId: randomUUID()
      }
    });
    expect(invalidate.statusCode).toBe(200);
    expect(invalidate.json().invalidation.sourceState).toBe('in_progress');
    const cancelled = await prisma.assemblyWorkSession.findUniqueOrThrow({
      where: { id: sessionId }
    });
    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      cancelReason: '仕掛品の作業取消'
    });
    expect(await prisma.assemblyWorkSessionOperatorAccess.count({
      where: { sessionId }
    })).toBe(2);
    expect((await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${sessionId}/record-torque`,
      headers,
      payload: { value: 10, source: 'manual' }
    })).statusCode).toBe(409);

    const workbookRes = await app.inject({
      method: 'GET',
      url: `/api/assembly/work-sessions/${sessionId}/export.xlsx`,
      headers
    });
    expect(workbookRes.statusCode).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(workbookRes.rawPayload);
    expect(workbook.getWorksheet('作業者・無効化履歴')?.rowCount).toBe(4);

    const reservedWorkId = await app.inject({
      method: 'POST',
      url: '/api/assembly/lots',
      headers,
      payload: {
        templateId,
        productNo: 'NFC-GATE-OTHER',
        expectedQuantity: 1,
        workIdMode: 'manual',
        workIds: [serial.workId],
        targetUnit: 'NFC機',
        torqueWrenchId: 'CEM20N3X10D-BTLA'
      }
    });
    expect(reservedWorkId.statusCode).toBe(409);
  });

  it('serializes start, torque, and approval races against invalidation without 500s or orphan history', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey, 'Content-Type': 'application/json' };
    const operator = await createTestEmployee({ displayName: '競合作業者' });
    const approver = await createTestEmployee({ displayName: '競合承認者' });
    const publishedDoc = await uploadPublishedProcedureDocument(app, headers, '削除競合手順');
    const templateRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload: buildTemplatePayload(publishedDoc.id, {
        modelCode: 'INVALIDATION-RACE',
        procedurePattern: '競合'
      })
    });
    const templateId = templateRes.json().template.id as string;

    const createLot = async (productNo: string) => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/assembly/lots',
        headers,
        payload: {
          templateId,
          productNo,
          expectedQuantity: 1,
          workIdMode: 'auto',
          targetUnit: '競合試験機',
          torqueWrenchId: 'CEM20N3X10D-BTLA'
        }
      });
      expect(response.statusCode).toBe(200);
      return response.json().lot as {
        id: string;
        serials: Array<{ id: string; workUnitId: string }>;
      };
    };
    const startLot = async (productNo: string) => {
      const lot = await createLot(productNo);
      const serial = lot.serials[0];
      const response = await app.inject({
        method: 'POST',
        url: `/api/assembly/lots/${lot.id}/serials/${serial.id}/start`,
        headers,
        payload: {
          operatorNfcTagUid: operator.nfcTagUid,
          requestId: randomUUID()
        }
      });
      expect(response.statusCode).toBe(200);
      return {
        lot,
        serial,
        sessionId: response.json().session.id as string
      };
    };
    const invalidate = (workUnitId: string, reason: string) =>
      app.inject({
        method: 'POST',
        url: `/api/assembly/work-units/${workUnitId}/invalidate`,
        headers,
        payload: {
          accessPassword: '2520',
          reason,
          requestId: randomUUID()
        }
      });

    const startRaceLot = await createLot('RACE-START');
    const startRaceSerial = startRaceLot.serials[0];
    const [startRace, startInvalidation] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/assembly/lots/${startRaceLot.id}/serials/${startRaceSerial.id}/start`,
        headers,
        payload: {
          operatorNfcTagUid: operator.nfcTagUid,
          requestId: randomUUID()
        }
      }),
      invalidate(startRaceSerial.workUnitId, '開始との競合')
    ]);
    expect(startInvalidation.statusCode).toBe(200);
    expect([200, 409]).toContain(startRace.statusCode);
    expect(startRace.statusCode).not.toBe(500);
    expect(await prisma.assemblyWorkUnitInvalidation.count({
      where: { workUnitId: startRaceSerial.workUnitId }
    })).toBe(1);
    const startRaceSession = await prisma.assemblyWorkSession.findUnique({
      where: { workUnitId: startRaceSerial.workUnitId }
    });
    if (startRaceSession) expect(startRaceSession.status).toBe('CANCELLED');

    const torqueRace = await startLot('RACE-TORQUE');
    const [torqueRecord, torqueInvalidation] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/assembly/work-sessions/${torqueRace.sessionId}/record-torque`,
        headers,
        payload: { value: 10, source: 'manual' }
      }),
      invalidate(torqueRace.serial.workUnitId, 'トルク入力との競合')
    ]);
    expect(torqueInvalidation.statusCode).toBe(200);
    expect([200, 409]).toContain(torqueRecord.statusCode);
    expect(torqueRecord.statusCode).not.toBe(500);
    expect((await prisma.assemblyWorkSession.findUniqueOrThrow({
      where: { id: torqueRace.sessionId }
    })).status).toBe('CANCELLED');
    expect(await prisma.assemblyTorqueRecord.count({
      where: { sessionId: torqueRace.sessionId }
    })).toBe(torqueRecord.statusCode === 200 ? 1 : 0);

    const approvalRace = await startLot('RACE-APPROVAL');
    expect((await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${approvalRace.sessionId}/record-torque`,
      headers,
      payload: { value: 10, source: 'manual' }
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${approvalRace.sessionId}/complete`,
      headers,
      payload: {}
    })).statusCode).toBe(200);
    const [approval, completedInvalidation] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/assembly/work-sessions/${approvalRace.sessionId}/record-approval/approve`,
        headers,
        payload: { approverEmployeeTagUid: approver.nfcTagUid }
      }),
      invalidate(approvalRace.serial.workUnitId, '完了承認との競合')
    ]);
    expect(completedInvalidation.statusCode).toBe(200);
    expect([200, 409]).toContain(approval.statusCode);
    expect(approval.statusCode).not.toBe(500);
    expect((await prisma.assemblyWorkSession.findUniqueOrThrow({
      where: { id: approvalRace.sessionId }
    })).status).toBe('COMPLETED');
    expect(await prisma.assemblyTorqueRecord.count({
      where: { sessionId: approvalRace.sessionId }
    })).toBe(1);
    expect(await prisma.assemblyWorkUnitInvalidation.count({
      where: { workUnitId: approvalRace.serial.workUnitId }
    })).toBe(1);
  });

  it('blocks invalidation for active composition or formal IDs and preserves approved completed sessions', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey, 'Content-Type': 'application/json' };
    const approver = await createTestEmployee({ displayName: '削除監査承認者' });
    const publishedDoc = await uploadPublishedProcedureDocument(app, headers, '削除ブロック手順');
    const templateRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload: buildTemplatePayload(publishedDoc.id, {
        modelCode: 'INVALIDATION-BLOCK',
        procedurePattern: '監査'
      })
    });
    const templateId = templateRes.json().template.id as string;

    const createCompleted = async (workId: string) => {
      const workUnit = await prisma.assemblyWorkUnit.create({ data: { workId } });
      const session = await prisma.assemblyWorkSession.create({
        data: {
          templateId,
          workUnitId: workUnit.id,
          productNo: `PRODUCT-${workId}`,
          workId,
          nameplateNo: workId,
          status: 'COMPLETED',
          operatorNameSnapshot: '完了作業者',
          targetUnit: '監査機',
          torqueWrenchId: 'CEM20N3X10D-BTLA',
          completedAt: new Date()
        }
      });
      return { workUnit, session };
    };
    const invalidate = (workUnitId: string, reason: string) =>
      app.inject({
        method: 'POST',
        url: `/api/assembly/work-units/${workUnitId}/invalidate`,
        headers,
        payload: {
          accessPassword: '2520',
          reason,
          requestId: randomUUID()
        }
      });

    const parent = await createCompleted('BLOCK-PARENT');
    const child = await createCompleted('BLOCK-CHILD');
    const link = await app.inject({
      method: 'POST',
      url: '/api/assembly/traceability/links',
      headers,
      payload: {
        parentWorkId: parent.workUnit.workId,
        childWorkId: child.workUnit.workId,
        accessPassword: '2520'
      }
    });
    expect(link.statusCode).toBe(200);
    expect((await invalidate(child.workUnit.id, '構成中の削除')).statusCode).toBe(409);

    const unlink = await app.inject({
      method: 'POST',
      url: `/api/assembly/traceability/links/${link.json().link.id as string}/unlink`,
      headers,
      payload: {
        accessPassword: '2520',
        reason: '正式IDブロック試験へ移行'
      }
    });
    expect(unlink.statusCode).toBe(200);
    const formal = await app.inject({
      method: 'POST',
      url: '/api/assembly/traceability/formal-identifiers',
      headers,
      payload: {
        workId: parent.workUnit.workId,
        formalId: 'BLOCK-FORMAL-ID',
        accessPassword: '2520'
      }
    });
    expect(formal.statusCode).toBe(200);
    expect((await invalidate(parent.workUnit.id, '正式IDありの削除')).statusCode).toBe(409);

    const approved = await createCompleted('APPROVED-PRESERVED');
    const approval = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${approved.session.id}/record-approval/approve`,
      headers,
      payload: { approverEmployeeTagUid: approver.nfcTagUid }
    });
    expect(approval.statusCode).toBe(200);
    const invalidation = await invalidate(approved.workUnit.id, '承認済み誤登録');
    expect(invalidation.statusCode).toBe(200);
    expect(invalidation.json().invalidation.sourceState).toBe('approved');
    const preserved = await prisma.assemblyWorkSession.findUniqueOrThrow({
      where: { id: approved.session.id },
      include: { approval: true }
    });
    expect(preserved.status).toBe('COMPLETED');
    expect(preserved.approval).not.toBeNull();
    expect(preserved.cancelledAt).toBeNull();
  });

  it('verifies the shared 2520 password for template editing and removes legacy order APIs', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey, 'Content-Type': 'application/json' };

    const failed = await app.inject({
      method: 'POST',
      url: '/api/kiosk/assembly/templates/verify-access-password',
      headers,
      payload: { password: '0000' }
    });
    expect(failed.statusCode).toBe(200);
    expect(failed.json()).toEqual({ success: false });

    const succeeded = await app.inject({
      method: 'POST',
      url: '/api/kiosk/assembly/templates/verify-access-password',
      headers,
      payload: { password: '2520' }
    });
    expect(succeeded.statusCode).toBe(200);
    expect(succeeded.json()).toEqual({ success: true });

    const removedAuth = await app.inject({
      method: 'POST',
      url: '/api/kiosk/assembly/procedure-order-settings/verify-access-password',
      headers,
      payload: { password: '2520' }
    });
    expect(removedAuth.statusCode).toBe(404);

    const removedRead = await app.inject({
      method: 'GET',
      url: '/api/assembly/procedure-orders?machineName=MH-AX',
      headers
    });
    expect(removedRead.statusCode).toBe(404);

    const removedWrite = await app.inject({
      method: 'PUT',
      url: '/api/assembly/procedure-orders',
      headers,
      payload: { machineName: 'MH-AX', accessPassword: '2520', items: [] }
    });
    expect(removedWrite.statusCode).toBe(404);
  });

  it('creates one immutable template version with document sequence, areas and markers', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey, 'Content-Type': 'application/json' };
    const primary = await uploadPublishedProcedureDocument(app, headers, '統合 主手順書');
    const secondary = await uploadPublishedProcedureDocument(app, headers, '統合 補助手順書');
    const kiosk = await createKioskDocumentWithRenderedPages({ title: '統合PDF', pageCount: 2 });
    const payload = {
      ...buildTemplatePayload(primary.id, {
        modelCode: 'UNIFIED-001',
        procedurePattern: '標準',
        name: '統合テンプレート'
      }),
      accessPassword: '2520',
      procedureItems: [
        { kioskDocumentId: kiosk.id, label: '準備' },
        { assemblyProcedureDocumentId: primary.id, label: '主工程' },
        { assemblyProcedureDocumentId: secondary.id, label: '確認' }
      ]
    };

    const unlistedKiosk = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload
    });
    expect(unlistedKiosk.statusCode).toBe(400);
    expect(unlistedKiosk.json().message).toContain(
      '要領書PDFは既存の閲覧順からのみ引き継げます'
    );

    await seedLegacyProcedureOrder('UNIFIED-001', [
      { kioskDocumentId: kiosk.id, label: '準備' },
      { assemblyProcedureDocumentId: primary.id, label: '主工程' },
      { assemblyProcedureDocumentId: secondary.id, label: '確認' }
    ]);

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload: { ...payload, accessPassword: '0000' }
    });
    expect(wrongPassword.statusCode).toBe(403);
    expect(await prisma.assemblyTemplate.count({ where: { modelCode: 'UNIFIED-001' } })).toBe(0);

    const created = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().template.procedureSequence).toMatchObject({
      source: 'template_version',
      items: [
        expect.objectContaining({ kioskDocumentId: kiosk.id, label: '準備', sortOrder: 0 }),
        expect.objectContaining({
          assemblyProcedureDocumentId: primary.id,
          label: '主工程',
          sortOrder: 1
        }),
        expect.objectContaining({
          assemblyProcedureDocumentId: secondary.id,
          label: '確認',
          sortOrder: 2
        })
      ]
    });
    expect(created.json().template.areas[0].bolts[0]).toMatchObject({
      assemblyProcedureDocumentId: primary.id,
      kioskDocumentId: null,
      pageIndex: 0
    });
    expect(
      await prisma.assemblyTemplateProcedureItem.count({
        where: { templateId: created.json().template.id }
      })
    ).toBe(3);

    const summary = await app.inject({
      method: 'GET',
      url: `/api/assembly/templates/summary?procedureDocumentId=${secondary.id}`,
      headers
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().templates[0]).toMatchObject({
      id: created.json().template.id,
      procedureItemCount: 3,
      usesLegacyProcedureSequence: false
    });
    const kioskNameSearch = await app.inject({
      method: 'GET',
      url: '/api/assembly/templates/summary?q=%E7%B5%B1%E5%90%88PDF',
      headers
    });
    expect(kioskNameSearch.statusCode).toBe(200);
    expect(kioskNameSearch.json().templates[0].id).toBe(created.json().template.id);
    const kioskNameOptions = await app.inject({
      method: 'GET',
      url: '/api/assembly/library/filter-options?field=templateProcedureDocumentName&q=%E7%B5%B1%E5%90%88PDF',
      headers
    });
    expect(kioskNameOptions.statusCode).toBe(200);
    expect(kioskNameOptions.json().options).toContain('統合PDF');

    const unpublishReferenced = await app.inject({
      method: 'POST',
      url: `/api/assembly/procedure-documents/${secondary.id}/unpublish`,
      headers: { 'x-client-key': client.apiKey }
    });
    expect(unpublishReferenced.statusCode).toBe(409);

    const admin = await createTestUser('ADMIN');
    const deleteReferencedKiosk = await app.inject({
      method: 'DELETE',
      url: `/api/kiosk-documents/${kiosk.id}`,
      headers: createAuthHeader(admin.token)
    });
    expect(deleteReferencedKiosk.statusCode).toBe(409);
  });

  it('stores crop/full steps, copies them on revision, and keeps a started session on its original steps', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey, 'Content-Type': 'application/json' };
    const primary = await uploadPublishedProcedureDocument(app, headers, 'ステップ 主手順書');
    const secondary = await uploadPublishedProcedureDocument(app, headers, 'ステップ 補助手順書');
    const payload = {
      ...buildTemplatePayload(primary.id, {
        modelCode: 'STEP-STORY-001',
        procedurePattern: '標準',
        name: 'ステップ v1'
      }),
      accessPassword: '2520',
      procedureItems: [
        { assemblyProcedureDocumentId: secondary.id, label: '補助' },
        { assemblyProcedureDocumentId: primary.id, label: '主' }
      ],
      procedureSteps: [
        {
          assemblyProcedureDocumentId: primary.id,
          pageIndex: 0,
          viewMode: 'crop',
          cropXRatio: 0.1,
          cropYRatio: 0.1,
          cropWidthRatio: 0.4,
          cropHeightRatio: 0.4,
          title: '締付点を確認',
          instructionText: '丸数字1を締め付ける',
          emphasis: 'important'
        },
        {
          assemblyProcedureDocumentId: primary.id,
          pageIndex: 0,
          viewMode: 'full_page',
          title: '全体確認'
        },
        {
          assemblyProcedureDocumentId: secondary.id,
          pageIndex: 0,
          viewMode: 'full_page',
          emphasis: 'caution'
        }
      ]
    };
    const created = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload
    });
    expect(created.statusCode).toBe(200);
    const v1 = created.json().template;
    expect(v1.procedureSequence).toMatchObject({
      source: 'template_version',
      stepSource: 'template_steps',
      items: [
        expect.objectContaining({ assemblyProcedureDocumentId: primary.id, sortOrder: 0 }),
        expect.objectContaining({ assemblyProcedureDocumentId: secondary.id, sortOrder: 1 })
      ],
      steps: [
        expect.objectContaining({
          sortOrder: 0,
          viewMode: 'crop',
          cropXRatio: 0.1,
          emphasis: 'important'
        }),
        expect.objectContaining({ sortOrder: 1, viewMode: 'full_page' }),
        expect.objectContaining({ sortOrder: 2, assemblyProcedureDocumentId: secondary.id })
      ]
    });
    expect(
      await prisma.assemblyTemplateProcedureStep.count({ where: { templateId: v1.id } })
    ).toBe(3);

    const started = await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers,
      payload: {
        templateId: v1.id,
        productNo: 'STEP-STORY-PRODUCT',
        serialNo: 'STEP-STORY-SERIAL',
        operatorNfcTagUid: directStartOperatorNfcTagUid,
        requestId: randomUUID(),
        targetUnit: 'STEP-STORY-001',
        torqueWrenchId: 'CEM20N3X10D-BTLA'
      }
    });
    expect(started.statusCode).toBe(200);

    const revised = await app.inject({
      method: 'POST',
      url: `/api/assembly/templates/${v1.id}/revise`,
      headers,
      payload: { name: 'ステップ v2' }
    });
    expect(revised.statusCode).toBe(200);
    expect(revised.json().template.procedureSequence.steps).toHaveLength(3);
    expect(revised.json().template.procedureSequence.stepSource).toBe('template_steps');

    const sessionSequence = await app.inject({
      method: 'GET',
      url: `/api/assembly/work-sessions/${started.json().session.id}/procedure-sequence`,
      headers
    });
    expect(sessionSequence.statusCode).toBe(200);
    expect(sessionSequence.json().sequence.stepSource).toBe('template_steps');
    expect(sessionSequence.json().sequence.steps).toHaveLength(3);
    expect(sessionSequence.json().sequence.steps[0]).toMatchObject({
      title: '締付点を確認',
      viewMode: 'crop',
      documentTitle: 'ステップ 主手順書'
    });

    const markerHidden = await app.inject({
      method: 'POST',
      url: `/api/assembly/templates/${revised.json().template.id}/revise`,
      headers,
      payload: {
        accessPassword: '2520',
        procedureSteps: [
          {
            assemblyProcedureDocumentId: primary.id,
            pageIndex: 0,
            viewMode: 'crop',
            cropXRatio: 0.6,
            cropYRatio: 0.6,
            cropWidthRatio: 0.2,
            cropHeightRatio: 0.2
          },
          {
            assemblyProcedureDocumentId: secondary.id,
            pageIndex: 0,
            viewMode: 'full_page'
          }
        ]
      }
    });
    expect(markerHidden.statusCode).toBe(400);
    expect(markerHidden.json().message).toContain('マーカーが見える表示ステップ');
  });

  it('keeps a work session on its template-version sequence after revision and legacy-order changes', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey, 'Content-Type': 'application/json' };
    const primary = await uploadPublishedProcedureDocument(app, headers, '固定版 主手順書');
    const kioskV1 = await createKioskDocumentWithRenderedPages({ title: '固定版V1', pageCount: 1 });
    const kioskV2 = await createKioskDocumentWithRenderedPages({ title: '固定版V2', pageCount: 1 });
    await seedLegacyProcedureOrder('IMMUTABLE-001', [
      { assemblyProcedureDocumentId: primary.id, label: '主工程' },
      { kioskDocumentId: kioskV1.id, label: 'V1 PDF' }
    ]);
    const createV1 = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload: {
        ...buildTemplatePayload(primary.id, {
          modelCode: 'IMMUTABLE-001',
          procedurePattern: '標準',
          name: '固定版 v1'
        }),
        accessPassword: '2520',
        procedureItems: [
          { assemblyProcedureDocumentId: primary.id, label: '主工程' },
          { kioskDocumentId: kioskV1.id, label: 'V1 PDF' }
        ]
      }
    });
    expect(createV1.statusCode).toBe(200);
    const v1Id = createV1.json().template.id as string;

    const started = await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers,
      payload: {
        templateId: v1Id,
        productNo: 'IMMUTABLE-PRODUCT',
        serialNo: 'IMMUTABLE-SERIAL',
        operatorNfcTagUid: directStartOperatorNfcTagUid,
        requestId: randomUUID(),
        targetUnit: 'IMMUTABLE-001',
        torqueWrenchId: 'CEM20N3X10D-BTLA'
      }
    });
    expect(started.statusCode).toBe(200);

    await seedLegacyProcedureOrder('IMMUTABLE-001', [
      { assemblyProcedureDocumentId: primary.id, label: '主工程' },
      { kioskDocumentId: kioskV2.id, label: 'V2 PDF' }
    ]);

    const revised = await app.inject({
      method: 'POST',
      url: `/api/assembly/templates/${v1Id}/revise`,
      headers,
      payload: {
        name: '固定版 v2',
        procedureDocumentId: primary.id,
        accessPassword: '2520',
        procedureItems: [
          { assemblyProcedureDocumentId: primary.id, label: '主工程' },
          { kioskDocumentId: kioskV2.id, label: 'V2 PDF' }
        ]
      }
    });
    expect(revised.statusCode).toBe(200);

    await seedLegacyProcedureOrder('IMMUTABLE-001', [
      { kioskDocumentId: kioskV2.id, label: '後日設定' }
    ]);

    const sequence = await app.inject({
      method: 'GET',
      url: `/api/assembly/work-sessions/${started.json().session.id}/procedure-sequence`,
      headers
    });
    expect(sequence.statusCode).toBe(200);
    expect(sequence.json().sequence.source).toBe('template_version');
    expect(
      sequence
        .json()
        .sequence.documents.map((document: { kioskDocumentId: string | null }) => document.kioskDocumentId)
    ).toEqual([null, kioskV1.id]);
  });

  it('rejects marker-orphaning and stale revisions without changing the active version', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey, 'Content-Type': 'application/json' };
    const primary = await uploadPublishedProcedureDocument(app, headers, '競合 主手順書');
    const kiosk = await createKioskDocumentWithRenderedPages({ title: '競合PDF', pageCount: 1 });
    await seedLegacyProcedureOrder('UNIFIED-LOCK', [
      { assemblyProcedureDocumentId: primary.id },
      { kioskDocumentId: kiosk.id }
    ]);
    const payload = buildTemplatePayload(primary.id, {
      modelCode: 'UNIFIED-LOCK',
      procedurePattern: '標準',
      name: '競合 v1'
    });
    payload.areas[0]!.bolts[0] = {
      ...payload.areas[0]!.bolts[0]!,
      kioskDocumentId: kiosk.id,
      pageIndex: 0
    };
    const created = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload: {
        ...payload,
        accessPassword: '2520',
        procedureItems: [
          { assemblyProcedureDocumentId: primary.id },
          { kioskDocumentId: kiosk.id }
        ]
      }
    });
    expect(created.statusCode).toBe(200);
    const v1Id = created.json().template.id as string;

    const orphaning = await app.inject({
      method: 'POST',
      url: `/api/assembly/templates/${v1Id}/revise`,
      headers,
      payload: {
        accessPassword: '2520',
        procedureDocumentId: primary.id,
        procedureItems: [{ assemblyProcedureDocumentId: primary.id }]
      }
    });
    expect(orphaning.statusCode).toBe(409);
    expect(await prisma.assemblyTemplate.count({ where: { modelCode: 'UNIFIED-LOCK' } })).toBe(1);
    expect(await prisma.assemblyTemplate.findUnique({ where: { id: v1Id }, select: { isActive: true } })).toEqual({
      isActive: true
    });

    const [firstRevision, staleRevision] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/assembly/templates/${v1Id}/revise`,
        headers,
        payload: { name: '競合 v2-A' }
      }),
      app.inject({
        method: 'POST',
        url: `/api/assembly/templates/${v1Id}/revise`,
        headers,
        payload: { name: '競合 v2-B' }
      })
    ]);
    expect([firstRevision.statusCode, staleRevision.statusCode].sort()).toEqual([200, 409]);
    expect(
      await prisma.assemblyTemplate.count({
        where: { modelCode: 'UNIFIED-LOCK', isActive: true }
      })
    ).toBe(1);
    const activeTemplate = await prisma.assemblyTemplate.findFirst({
      where: { modelCode: 'UNIFIED-LOCK', isActive: true },
      select: { id: true, _count: { select: { procedureItems: true } } }
    });
    expect(activeTemplate?._count.procedureItems).toBe(2);

    const [movedLineage, secondMovedLineage] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/assembly/templates/${activeTemplate!.id}/revise`,
        headers,
        payload: { modelCode: 'UNIFIED-LOCK-MOVED-A' }
      }),
      app.inject({
        method: 'POST',
        url: `/api/assembly/templates/${activeTemplate!.id}/revise`,
        headers,
        payload: { modelCode: 'UNIFIED-LOCK-MOVED-B' }
      })
    ]);
    expect([movedLineage.statusCode, secondMovedLineage.statusCode].sort()).toEqual([400, 400]);
    expect(
      await prisma.assemblyTemplate.findUnique({
        where: { id: activeTemplate!.id },
        select: { isActive: true }
      })
    ).toEqual({ isActive: true });
    expect(
      await prisma.assemblyTemplate.count({
        where: {
          modelCode: { in: ['UNIFIED-LOCK-MOVED-A', 'UNIFIED-LOCK-MOVED-B'] },
          isActive: true
        }
      })
    ).toBe(0);
  });

  it('reads the retained legacy sequence internally for an unversioned work session', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey };

    const upload = buildMultipartProcedure('MH-AX 締付点 手順書');
    const procedureDocRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/procedure-documents',
      headers: { ...headers, 'Content-Type': upload.contentType },
      payload: upload.body
    });
    expect(procedureDocRes.statusCode).toBe(200);
    const procedureDocumentId = procedureDocRes.json().document.id as string;
    await publishProcedureDocument(app, headers, procedureDocumentId);

    const templateRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: buildTemplatePayload(procedureDocumentId, { modelCode: 'MH-AX', procedurePattern: '標準', name: 'MH-AX 標準' })
    });
    expect(templateRes.statusCode).toBe(200);
    const templateId = templateRes.json().template.id as string;

    const docX = await createKioskDocumentWithRenderedPages({ title: 'X軸', pageCount: 2 });
    const docY = await createKioskDocumentWithRenderedPages({ title: 'Y軸', pageCount: 1 });

    await seedLegacyProcedureOrder('ｍｈ－ａｘ', [
      { kioskDocumentId: docY.id, label: 'Y軸' },
      { kioskDocumentId: docX.id, label: 'X軸-1' }
    ]);

    const startRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: {
        templateId,
        productNo: 'ASM-PDF-001',
        serialNo: 'S001',
        operatorNfcTagUid: directStartOperatorNfcTagUid,
        requestId: randomUUID(),
        targetUnit: 'mh-ax',
        torqueWrenchId: 'CEM20N3X10D-BTLA'
      }
    });
    expect(startRes.statusCode).toBe(200);
    const sessionId = startRes.json().session.id as string;

    const sequence = await app.inject({
      method: 'GET',
      url: `/api/assembly/work-sessions/${sessionId}/procedure-sequence`,
      headers
    });
    expect(sequence.statusCode).toBe(200);
    expect(sequence.json().sequence).toMatchObject({
      source: 'legacy_machine_order',
      mode: 'configured',
      machineName: 'MH-AX',
      machineNameKey: 'MH-AX'
    });
    expect(sequence.json().sequence.documents).toEqual([
      expect.objectContaining({
        kioskDocumentId: docY.id,
        label: 'Y軸',
        pageUrls: [`/api/storage/pdf-pages/${docY.id}/page-1.jpg`],
        pages: [
          expect.objectContaining({
            source: 'kiosk_document',
            documentId: docY.id,
            pageIndex: 0,
            pageUrl: `/api/storage/pdf-pages/${docY.id}/page-1.jpg`
          })
        ]
      }),
      expect.objectContaining({
        kioskDocumentId: docX.id,
        label: 'X軸-1',
        pageUrls: [`/api/storage/pdf-pages/${docX.id}/page-1.jpg`, `/api/storage/pdf-pages/${docX.id}/page-2.jpg`],
        pages: [
          expect.objectContaining({ source: 'kiosk_document', documentId: docX.id, pageIndex: 0 }),
          expect.objectContaining({ source: 'kiosk_document', documentId: docX.id, pageIndex: 1 })
        ]
      })
    ]);

    const fallbackStart = await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: {
        templateId,
        productNo: 'ASM-PDF-002',
        serialNo: 'S002',
        operatorNfcTagUid: directStartOperatorNfcTagUid,
        requestId: randomUUID(),
        targetUnit: 'NO-ORDER',
        torqueWrenchId: 'CEM20N3X10D-BTLA'
      }
    });
    expect(fallbackStart.statusCode).toBe(200);

    const fallbackSequence = await app.inject({
      method: 'GET',
      url: `/api/assembly/work-sessions/${fallbackStart.json().session.id}/procedure-sequence`,
      headers
    });
    expect(fallbackSequence.statusCode).toBe(200);
    expect(fallbackSequence.json().sequence).toMatchObject({
      source: 'primary_fallback',
      mode: 'fallback',
      reason: 'not_configured',
      machineNameKey: 'NO-ORDER',
      stepSource: 'document_expansion',
      fallbackProcedureDocument: expect.objectContaining({ id: procedureDocumentId })
    });
    expect(fallbackSequence.json().sequence.documents).toHaveLength(1);
    expect(fallbackSequence.json().sequence.steps).toEqual([
      expect.objectContaining({
        assemblyProcedureDocumentId: procedureDocumentId,
        pageIndex: 0,
        viewMode: 'full_page',
        documentType: 'assembly_procedure_document'
      })
    ]);
  });

  it('protects KioskDocument rows retained by an internal legacy sequence', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey, 'Content-Type': 'application/json' };
    const doc = await createKioskDocumentWithRenderedPages({ title: '削除保護', pageCount: 1 });

    await seedLegacyProcedureOrder('MH-LOCK', [
      { kioskDocumentId: doc.id, label: '保護対象' }
    ]);

    const admin = await createTestUser('ADMIN');
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/kiosk-documents/${doc.id}`,
      headers: createAuthHeader(admin.token)
    });
    expect(deleted.statusCode).toBe(409);
    expect(deleted.json()).toMatchObject({
      errorCode: 'KIOSK_DOC_ASSEMBLY_ORDER_IN_USE'
    });
  });

  it('resolves retained assembly-document legacy items in a work-session sequence', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey };

    const upload = buildMultipartProcedure('MH-AX 組立手順');
    const procedureDocRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/procedure-documents',
      headers: { ...headers, 'Content-Type': upload.contentType },
      payload: upload.body
    });
    expect(procedureDocRes.statusCode).toBe(200);
    const procedureDocument = procedureDocRes.json().document as {
      id: string;
      name: string;
      imageRelativePath: string;
    };
    await publishProcedureDocument(app, headers, procedureDocument.id);

    const templateRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: buildTemplatePayload(procedureDocument.id, { modelCode: 'MH-AX', procedurePattern: '標準', name: 'MH-AX 標準' })
    });
    expect(templateRes.statusCode).toBe(200);
    const templateId = templateRes.json().template.id as string;

    await seedLegacyProcedureOrder('MH-AX', [
      { assemblyProcedureDocumentId: procedureDocument.id, label: '組立手順' }
    ]);

    const startRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: {
        templateId,
        productNo: 'ASM-PROC-001',
        serialNo: 'S001',
        operatorNfcTagUid: directStartOperatorNfcTagUid,
        requestId: randomUUID(),
        targetUnit: 'MH-AX',
        torqueWrenchId: 'CEM20N3X10D-BTLA'
      }
    });
    expect(startRes.statusCode).toBe(200);
    const sessionId = startRes.json().session.id as string;

    const sequence = await app.inject({
      method: 'GET',
      url: `/api/assembly/work-sessions/${sessionId}/procedure-sequence`,
      headers
    });
    expect(sequence.statusCode).toBe(200);
    expect(sequence.json().sequence).toMatchObject({
      source: 'legacy_machine_order',
      mode: 'configured',
      machineNameKey: 'MH-AX'
    });
    expect(sequence.json().sequence.documents).toEqual([
      expect.objectContaining({
        documentType: 'assembly_procedure_document',
        assemblyProcedureDocumentId: procedureDocument.id,
        kioskDocumentId: null,
        label: '組立手順',
        title: procedureDocument.name,
        pageUrls: [procedureDocument.imageRelativePath],
        pages: [
          expect.objectContaining({
            source: 'assembly_procedure_document',
            documentId: procedureDocument.id,
            pageIndex: 0,
            pageUrl: procedureDocument.imageRelativePath
          })
        ]
      })
    ]);
  });

  it('protects an AssemblyProcedureDocument retained by an internal legacy sequence', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey, 'Content-Type': 'application/json' };

    const upload = buildMultipartProcedure('削除保護手順');
    const procedureDocRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/procedure-documents',
      headers: { ...headers, 'Content-Type': upload.contentType },
      payload: upload.body
    });
    expect(procedureDocRes.statusCode).toBe(200);
    const procedureDocumentId = procedureDocRes.json().document.id as string;
    await publishProcedureDocument(app, headers, procedureDocumentId);

    await seedLegacyProcedureOrder('MH-LOCK-PROC', [
      { assemblyProcedureDocumentId: procedureDocumentId, label: '保護対象' }
    ]);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/assembly/procedure-documents/${procedureDocumentId}`,
      headers: { 'x-client-key': client.apiKey }
    });
    expect(deleted.statusCode).toBe(409);
    expect(deleted.json()).toMatchObject({
      message: 'テンプレートで使用中の手順書は削除できません'
    });
  });

  it('approves completed assembly work session records via NFC and exposes approval in summary/detail', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey, 'Content-Type': 'application/json' };
    const approver = await createTestEmployee({
      displayName: 'Approval Tester',
      nfcTagUid: `EMP-ASM-APPROVER-${Date.now()}`
    });

    const upload = buildMultipartProcedure('Approval Test Procedure');
    const docRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/procedure-documents',
      headers: { ...headers, 'Content-Type': upload.contentType },
      payload: upload.body
    });
    const documentId = docRes.json().document.id as string;
    await publishProcedureDocument(app, headers, documentId);

    const templateRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload: buildTemplatePayload(documentId, { modelCode: 'ASM-APPROVAL', procedurePattern: '標準' })
    });
    const templateId = templateRes.json().template.id as string;

    const startRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers,
      payload: {
        templateId,
        productNo: 'ASM-APPROVAL-001',
        serialNo: 'S-APPROVAL-001',
        operatorNfcTagUid: directStartOperatorNfcTagUid,
        requestId: randomUUID(),
        targetUnit: 'X軸',
        torqueWrenchId: 'CEM20N3X10D-BTLA'
      }
    });
    const sessionId = startRes.json().session.id as string;

    const ok = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${sessionId}/record-torque`,
      headers,
      payload: { value: 10, source: 'manual' }
    });
    expect(ok.statusCode).toBe(200);

    const complete = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${sessionId}/complete`,
      headers: { 'x-client-key': client.apiKey }
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().session.approval).toBeNull();
    expect(complete.json().session.areaTorqueSummaries).toHaveLength(1);

    const summaryBefore = await app.inject({
      method: 'GET',
      url: '/api/assembly/work-sessions/summary?status=completed&productNo=ASM-APPROVAL-001',
      headers
    });
    expect(summaryBefore.statusCode).toBe(200);
    expect(summaryBefore.json().sessions[0].approval).toBeNull();

    const approve = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${sessionId}/record-approval/approve`,
      headers,
      payload: { approverEmployeeTagUid: approver.nfcTagUid }
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().session.approval).toMatchObject({
      approverEmployeeNameSnapshot: approver.displayName,
      approverEmployeeCodeSnapshot: approver.employeeCode
    });

    const duplicateApprove = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${sessionId}/record-approval/approve`,
      headers,
      payload: { approverEmployeeTagUid: approver.nfcTagUid }
    });
    expect(duplicateApprove.statusCode).toBe(409);

    const summaryAfter = await app.inject({
      method: 'GET',
      url: '/api/assembly/work-sessions/summary?status=completed&productNo=ASM-APPROVAL-001',
      headers
    });
    expect(summaryAfter.json().sessions[0].approval?.approverEmployeeNameSnapshot).toBe(approver.displayName);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/assembly/work-sessions/${sessionId}`,
      headers
    });
    expect(detail.json().session.approval?.approverEmployeeNameSnapshot).toBe(approver.displayName);
  });

  it('rejects assembly record approval for non-completed sessions and unknown NFC tags', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey, 'Content-Type': 'application/json' };

    const upload = buildMultipartProcedure('Approval Guard Procedure');
    const docRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/procedure-documents',
      headers: { ...headers, 'Content-Type': upload.contentType },
      payload: upload.body
    });
    const documentId = docRes.json().document.id as string;
    await publishProcedureDocument(app, headers, documentId);

    const templateRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/templates',
      headers,
      payload: buildTemplatePayload(documentId, { modelCode: 'ASM-GUARD', procedurePattern: '標準' })
    });
    const templateId = templateRes.json().template.id as string;

    const startRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers,
      payload: {
        templateId,
        productNo: 'ASM-GUARD-001',
        serialNo: 'S-GUARD-001',
        operatorNfcTagUid: directStartOperatorNfcTagUid,
        requestId: randomUUID(),
        targetUnit: 'Y軸',
        torqueWrenchId: 'CEM20N3X10D-BTLA'
      }
    });
    const sessionId = startRes.json().session.id as string;

    const inProgressApprove = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${sessionId}/record-approval/approve`,
      headers,
      payload: { approverEmployeeTagUid: 'UNKNOWN-TAG' }
    });
    expect(inProgressApprove.statusCode).toBe(409);

    const ok = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${sessionId}/record-torque`,
      headers,
      payload: { value: 10, source: 'manual' }
    });
    expect(ok.statusCode).toBe(200);

    const complete = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${sessionId}/complete`,
      headers: { 'x-client-key': client.apiKey }
    });
    expect(complete.statusCode).toBe(200);

    const unknownTagApprove = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${sessionId}/record-approval/approve`,
      headers,
      payload: { approverEmployeeTagUid: 'UNKNOWN-TAG-404' }
    });
    expect(unknownTagApprove.statusCode).toBe(404);
  });

  it('verifies assembly record approval access password via kiosk endpoint', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey, 'Content-Type': 'application/json' };

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/kiosk/assembly/record-approvals/verify-access-password',
      headers,
      payload: { password: '0000' }
    });
    expect(wrong.statusCode).toBe(200);
    expect(wrong.json()).toEqual({ success: false });

    const ok = await app.inject({
      method: 'POST',
      url: '/api/kiosk/assembly/record-approvals/verify-access-password',
      headers,
      payload: { password: '2520' }
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ success: true });
  });

  describe('assembly unified workflow phase 2 API', () => {
    it('imports procedure documents as draft with pages and supports publish/unpublish guards', async () => {
      const client = await createTestClientDevice();
      const headers = { 'x-client-key': client.apiKey, 'Content-Type': 'application/json' };

      const publishedDoc = await uploadPublishedProcedureDocument(app, headers, '公開済み手順');
      // boundary はミリ秒時刻由来のため、2回生成するとヘッダーと本文で不一致になり 400 になる（1回生成して使い回す）
      const draftUpload = buildMultipartProcedure('下書き手順');
      const draftDoc = await app.inject({
        method: 'POST',
        url: '/api/assembly/procedure-documents',
        headers: { ...headers, 'Content-Type': draftUpload.contentType },
        payload: draftUpload.body
      });
      expect(draftDoc.statusCode).toBe(200);
      const draftDocumentId = draftDoc.json().document.id as string;
      expect(draftDoc.json().document).toMatchObject({
        status: 'draft',
        publishedAt: null,
        pages: [expect.objectContaining({ pageIndex: 0 })]
      });

      const templateRes = await app.inject({
        method: 'POST',
        url: '/api/assembly/templates',
        headers,
        payload: buildTemplatePayload(publishedDoc.id, { modelCode: 'UWF-P2', procedurePattern: '標準' })
      });
      expect(templateRes.statusCode).toBe(200);

      const unpublishInUse = await app.inject({
        method: 'POST',
        url: `/api/assembly/procedure-documents/${publishedDoc.id}/unpublish`,
        headers: { 'x-client-key': client.apiKey }
      });
      expect(unpublishInUse.statusCode).toBe(409);

      const unpublishUnused = await app.inject({
        method: 'POST',
        url: `/api/assembly/procedure-documents/${draftDocumentId}/unpublish`,
        headers: { 'x-client-key': client.apiKey }
      });
      expect(unpublishUnused.statusCode).toBe(200);
      expect(unpublishUnused.json().document.status).toBe('draft');
    });

    it('upserts record-check and enforces complete gate for required check items', async () => {
      const client = await createTestClientDevice();
      const headers = { 'x-client-key': client.apiKey, 'Content-Type': 'application/json' };
      const kioskDoc = await createKioskDocumentWithRenderedPages({ title: 'Check Marker Doc', pageCount: 1 });
      const publishedDoc = await uploadPublishedProcedureDocument(app, headers, 'チェック付き手順');

      const templateRes = await app.inject({
        method: 'POST',
        url: '/api/assembly/templates',
        headers,
        payload: {
          ...buildTemplatePayload(publishedDoc.id, { modelCode: 'UWF-CHECK', procedurePattern: '標準' }),
          checkItems: [
            {
              markerNo: 1,
              label: '外観確認',
              required: true,
              xRatio: 0.2,
              yRatio: 0.2,
              sortOrder: 0,
              kioskDocumentId: kioskDoc.id,
              pageIndex: 0
            },
            {
              markerNo: 2,
              label: '任意確認',
              required: false,
              xRatio: 0.4,
              yRatio: 0.4,
              sortOrder: 1,
              kioskDocumentId: kioskDoc.id,
              pageIndex: 0
            }
          ]
        }
      });
      expect(templateRes.statusCode).toBe(200);
      const template = templateRes.json().template;
      const checkItemId = template.checkItems[0].id as string;

      const startRes = await app.inject({
        method: 'POST',
        url: '/api/assembly/work-sessions',
        headers,
        payload: {
          templateId: template.id,
          productNo: 'UWF-CHECK-001',
          serialNo: 'CHK-001',
          operatorNfcTagUid: directStartOperatorNfcTagUid,
          requestId: randomUUID(),
          targetUnit: 'UWF-CHECK',
          torqueWrenchId: 'CEM20N3X10D-BTLA'
        }
      });
      expect(startRes.statusCode).toBe(200);
      const sessionId = startRes.json().session.id as string;
      expect(startRes.json().session.checkSummary).toMatchObject({
        requiredTotal: 1,
        requiredCompleted: 0,
        allRequiredCompleted: false
      });

      const torque = await app.inject({
        method: 'POST',
        url: `/api/assembly/work-sessions/${sessionId}/record-torque`,
        headers,
        payload: { value: 10, source: 'manual' }
      });
      expect(torque.statusCode).toBe(200);

      const blockedComplete = await app.inject({
        method: 'POST',
        url: `/api/assembly/work-sessions/${sessionId}/complete`,
        headers: { 'x-client-key': client.apiKey }
      });
      expect(blockedComplete.statusCode).toBe(409);
      expect(blockedComplete.json().details.checkSummary).toMatchObject({
        requiredTotal: 1,
        requiredCompleted: 0,
        allRequiredCompleted: false
      });

      const firstCheck = await app.inject({
        method: 'POST',
        url: `/api/assembly/work-sessions/${sessionId}/record-check`,
        headers,
        payload: { checkItemId, checked: true }
      });
      expect(firstCheck.statusCode).toBe(200);
      expect(firstCheck.json().record).toMatchObject({ checkItemId, checked: true });
      expect(firstCheck.json().checkSummary.allRequiredCompleted).toBe(true);

      const secondCheck = await app.inject({
        method: 'POST',
        url: `/api/assembly/work-sessions/${sessionId}/record-check`,
        headers,
        payload: { checkItemId, checked: false }
      });
      expect(secondCheck.statusCode).toBe(200);
      expect(secondCheck.json().record.checked).toBe(false);
      expect(secondCheck.json().checkSummary.allRequiredCompleted).toBe(false);

      const recheck = await app.inject({
        method: 'POST',
        url: `/api/assembly/work-sessions/${sessionId}/record-check`,
        headers,
        payload: { checkItemId, checked: true }
      });
      expect(recheck.statusCode).toBe(200);

      const complete = await app.inject({
        method: 'POST',
        url: `/api/assembly/work-sessions/${sessionId}/complete`,
        headers: { 'x-client-key': client.apiKey }
      });
      expect(complete.statusCode).toBe(200);
      expect(complete.json().session.checkSummary.allRequiredCompleted).toBe(true);
    });

    it('excludes draft assembly procedure documents from configured procedure sequence page identifiers', async () => {
      const client = await createTestClientDevice();
      const headers = { 'x-client-key': client.apiKey, 'Content-Type': 'application/json' };

      const publishedDoc = await uploadPublishedProcedureDocument(app, headers, '公開シーケンス手順');
      const draftUpload = buildMultipartProcedure('下書きシーケンス手順');
      const draftRes = await app.inject({
        method: 'POST',
        url: '/api/assembly/procedure-documents',
        headers: { ...headers, 'Content-Type': draftUpload.contentType },
        payload: draftUpload.body
      });
      const draftDocumentId = draftRes.json().document.id as string;

      const templateRes = await app.inject({
        method: 'POST',
        url: '/api/assembly/templates',
        headers,
        payload: buildTemplatePayload(publishedDoc.id, { modelCode: 'UWF-SEQ', procedurePattern: '標準' })
      });
      const templateId = templateRes.json().template.id as string;

      await seedLegacyProcedureOrder('UWF-SEQ', [
        { assemblyProcedureDocumentId: publishedDoc.id, label: '公開' }
      ]);

      const orderSet = await prisma.assemblyProcedureOrderSet.findUnique({
        where: { machineNameKey: 'UWF-SEQ' }
      });
      expect(orderSet).not.toBeNull();
      await prisma.assemblyProcedureOrderItem.updateMany({
        where: { setId: orderSet!.id, assemblyProcedureDocumentId: publishedDoc.id },
        data: { sortOrder: 1 }
      });
      await prisma.assemblyProcedureOrderItem.create({
        data: {
          setId: orderSet!.id,
          assemblyProcedureDocumentId: draftDocumentId,
          sortOrder: 0,
          label: '下書き'
        }
      });

      const startRes = await app.inject({
        method: 'POST',
        url: '/api/assembly/work-sessions',
        headers,
        payload: {
          templateId,
          productNo: 'UWF-SEQ-001',
          serialNo: 'SEQ-001',
          operatorNfcTagUid: directStartOperatorNfcTagUid,
          requestId: randomUUID(),
          targetUnit: 'UWF-SEQ',
          torqueWrenchId: 'CEM20N3X10D-BTLA'
        }
      });
      const sessionId = startRes.json().session.id as string;

      const sequence = await app.inject({
        method: 'GET',
        url: `/api/assembly/work-sessions/${sessionId}/procedure-sequence`,
        headers: { 'x-client-key': client.apiKey }
      });
      expect(sequence.statusCode).toBe(200);
      expect(sequence.json().sequence.documents).toHaveLength(1);
      expect(sequence.json().sequence.documents[0]).toMatchObject({
        assemblyProcedureDocumentId: publishedDoc.id,
        label: '公開',
        pages: [
          expect.objectContaining({
            source: 'assembly_procedure_document',
            documentId: publishedDoc.id,
            pageIndex: 0,
            pageUrl: publishedDoc.imageRelativePath
          })
        ]
      });
    });

    it('allows legacy templates without check items to complete after bolt acceptance only', async () => {
      const client = await createTestClientDevice();
      const headers = { 'x-client-key': client.apiKey, 'Content-Type': 'application/json' };
      const publishedDoc = await uploadPublishedProcedureDocument(app, headers, 'レガシー互換手順');

      const templateRes = await app.inject({
        method: 'POST',
        url: '/api/assembly/templates',
        headers,
        payload: buildTemplatePayload(publishedDoc.id, { modelCode: 'UWF-LEGACY', procedurePattern: '標準' })
      });
      expect(templateRes.statusCode).toBe(200);
      expect(templateRes.json().template.checkItems).toEqual([]);

      const startRes = await app.inject({
        method: 'POST',
        url: '/api/assembly/work-sessions',
        headers,
        payload: {
          templateId: templateRes.json().template.id,
          productNo: 'UWF-LEGACY-001',
          serialNo: 'LEG-001',
          operatorNfcTagUid: directStartOperatorNfcTagUid,
          requestId: randomUUID(),
          targetUnit: 'UWF-LEGACY',
          torqueWrenchId: 'CEM20N3X10D-BTLA'
        }
      });
      const sessionId = startRes.json().session.id as string;
      expect(startRes.json().session.checkSummary).toMatchObject({
        requiredTotal: 0,
        requiredCompleted: 0,
        allRequiredCompleted: true
      });

      const torque = await app.inject({
        method: 'POST',
        url: `/api/assembly/work-sessions/${sessionId}/record-torque`,
        headers,
        payload: { value: 10, source: 'manual' }
      });
      expect(torque.statusCode).toBe(200);

      const complete = await app.inject({
        method: 'POST',
        url: `/api/assembly/work-sessions/${sessionId}/complete`,
        headers: { 'x-client-key': client.apiKey }
      });
      expect(complete.statusCode).toBe(200);
    });

    it('links completed work IDs, preserves correction history, and reserves formal IDs', async () => {
      const client = await createTestClientDevice();
      const headers = { 'x-client-key': client.apiKey, 'Content-Type': 'application/json' };
      const publishedDoc = await uploadPublishedProcedureDocument(app, headers, '構成・正式ID手順');
      const templateRes = await app.inject({
        method: 'POST',
        url: '/api/assembly/templates',
        headers,
        payload: buildTemplatePayload(publishedDoc.id, { modelCode: 'TRACEABILITY', procedurePattern: '構成' })
      });
      expect(templateRes.statusCode).toBe(200);
      const templateId = templateRes.json().template.id as string;

      const workIdLot = await app.inject({
        method: 'POST',
        url: '/api/assembly/lots',
        headers,
        payload: {
          templateId,
          productNo: 'P-WORK-ID-LOT',
          expectedQuantity: 1,
          workIds: ['work-id-001'],
          operatorNameSnapshot: '構成テスト',
          targetUnit: '構成テスト機',
          torqueWrenchId: 'CEM20N3X10D-BTLA'
        }
      });
      expect(workIdLot.statusCode).toBe(200);
      expect(workIdLot.json().lot.serials[0]).toMatchObject({ workId: 'WORK-ID-001', serialNo: 'WORK-ID-001' });

      const seedWorkUnit = async (workId: string, status: 'COMPLETED' | 'IN_PROGRESS' = 'COMPLETED') => {
        const workUnit = await prisma.assemblyWorkUnit.create({ data: { workId } });
        await prisma.assemblyWorkSession.create({
          data: {
            templateId,
            workUnitId: workUnit.id,
            productNo: `P-${workId}`,
            workId,
            nameplateNo: `NAME-${workId}`,
            status,
            operatorNameSnapshot: '構成テスト',
            targetUnit: '構成テスト機',
            torqueWrenchId: 'CEM20N3X10D-BTLA',
            completedAt: status === 'COMPLETED' ? new Date() : null
          }
        });
        return workUnit;
      };

      await seedWorkUnit('FINAL-001');
      await seedWorkUnit('FINAL-002');
      await seedWorkUnit('SUB-001');
      await seedWorkUnit('SUB-002');
      await seedWorkUnit('SUB-003');
      await seedWorkUnit('SUB-WIP', 'IN_PROGRESS');

      const missingPassword = await app.inject({
        method: 'POST',
        url: '/api/assembly/traceability/links',
        headers,
        payload: { parentWorkId: 'FINAL-001', childWorkId: 'SUB-001' }
      });
      expect(missingPassword.statusCode).toBe(403);

      const link = async (parentWorkId: string, childWorkId: string) => app.inject({
        method: 'POST',
        url: '/api/assembly/traceability/links',
        headers,
        payload: { parentWorkId, childWorkId, accessPassword: '2520' }
      });
      const firstLink = await link('FINAL-001', 'SUB-001');
      expect(firstLink.statusCode).toBe(200);
      const secondLink = await link('SUB-001', 'SUB-002');
      expect(secondLink.statusCode).toBe(200);
      expect((await link('FINAL-002', 'SUB-001')).statusCode).toBe(409);
      expect((await link('FINAL-001', 'SUB-WIP')).statusCode).toBe(409);
      expect((await link('SUB-002', 'FINAL-001')).statusCode).toBe(409);

      const changeSource = await link('FINAL-001', 'SUB-003');
      expect(changeSource.statusCode).toBe(200);
      const reassign = await app.inject({
        method: 'POST',
        url: `/api/assembly/traceability/links/${changeSource.json().link.id as string}/reassign`,
        headers,
        payload: { parentWorkId: 'FINAL-002', reason: '完成品を変更', accessPassword: '2520' }
      });
      expect(reassign.statusCode).toBe(200);
      const unlink = await app.inject({
        method: 'POST',
        url: `/api/assembly/traceability/links/${reassign.json().link.id as string}/unlink`,
        headers,
        payload: { reason: '構成を取り消し', accessPassword: '2520' }
      });
      expect(unlink.statusCode).toBe(200);
      const subThree = await prisma.assemblyWorkUnit.findUniqueOrThrow({ where: { workId: 'SUB-003' } });
      expect(await prisma.assemblyWorkUnitComposition.count({ where: { childWorkUnitId: subThree.id, unlinkedAt: { not: null } } })).toBe(2);

      const resolveBeforeFormal = await app.inject({
        method: 'POST',
        url: '/api/assembly/traceability/work-units/resolve',
        headers,
        payload: { workId: 'FINAL-001' }
      });
      expect(resolveBeforeFormal.statusCode).toBe(200);
      expect(resolveBeforeFormal.json().genealogy[0].children[0].workUnit.workId).toBe('SUB-001');

      const childFormal = await app.inject({
        method: 'POST',
        url: '/api/assembly/traceability/formal-identifiers',
        headers,
        payload: { workId: 'SUB-001', formalId: 'FORMAL-CHILD', accessPassword: '2520' }
      });
      expect(childFormal.statusCode).toBe(409);

      const initialFormal = await app.inject({
        method: 'POST',
        url: '/api/assembly/traceability/formal-identifiers',
        headers,
        payload: { workId: 'FINAL-001', formalId: 'FORMAL-001', accessPassword: '2520' }
      });
      expect(initialFormal.statusCode).toBe(200);
      const formalAssignmentId = initialFormal.json().formalIdentifier.id as string;

      const correction = await app.inject({
        method: 'POST',
        url: `/api/assembly/traceability/formal-identifiers/${formalAssignmentId}/correct`,
        headers,
        payload: { formalId: 'FORMAL-002', reason: '銘板の記載誤り', accessPassword: '2520' }
      });
      expect(correction.statusCode).toBe(200);
      expect((await app.inject({
        method: 'POST',
        url: '/api/assembly/traceability/formal-identifiers',
        headers,
        payload: { workId: 'FINAL-002', formalId: 'FORMAL-001', accessPassword: '2520' }
      })).statusCode).toBe(409);

      const resolveAfterFormal = await app.inject({
        method: 'POST',
        url: '/api/assembly/traceability/work-units/resolve',
        headers,
        payload: { workId: 'FINAL-001' }
      });
      expect(resolveAfterFormal.statusCode).toBe(200);
      expect(resolveAfterFormal.json().root.formalIdentifier.formalId).toBe('FORMAL-002');
      expect(resolveAfterFormal.json().formalIdentifierHistory).toHaveLength(2);

      const exportRes = await app.inject({
        method: 'GET',
        url: `/api/assembly/work-sessions/${(await prisma.assemblyWorkSession.findFirstOrThrow({ where: { workId: 'FINAL-001' } })).id}/export.xlsx`,
        headers: { 'x-client-key': client.apiKey }
      });
      expect(exportRes.statusCode).toBe(200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(exportRes.rawPayload);
      expect(workbook.getWorksheet('構成・正式ID履歴')).toBeDefined();
      expect(workbook.getWorksheet('概要')?.getColumn(1).values).toContain('正式ID');
    });
  });
});
