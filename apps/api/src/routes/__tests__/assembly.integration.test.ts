import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
  SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL
} from '../../services/production-schedule/constants.js';
import { SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION } from '../../services/production-schedule/production-schedule-settings.service.js';
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
    headers: publishHeaders
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

async function cleanAssemblyTables() {
  await prisma.assemblyProcedureOrderItem.deleteMany({});
  await prisma.assemblyProcedureOrderSet.deleteMany({});
  await prisma.assemblyWorkSessionApproval.deleteMany({});
  await prisma.assemblyAreaRestartLog.deleteMany({});
  await prisma.assemblyTorqueRecord.deleteMany({});
  await prisma.assemblyWorkSession.deleteMany({});
  await prisma.assemblyLotSerial.deleteMany({});
  await prisma.assemblyLot.deleteMany({});
  await prisma.assemblySerialRegistry.deleteMany({});
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

  beforeAll(async () => {
    app = await buildServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAssemblyTables();
    await cleanAssemblySeibanSearchFixtures();
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
        operatorNameSnapshot: '競合テスト',
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
        operatorNameSnapshot: '佐藤',
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
      operatorNameSnapshot: '佐藤',
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
      payload: { ...startPayload, operatorNameSnapshot: '田中' }
    });
    expect(duplicateStart.statusCode).toBe(200);
    expect(duplicateStart.json().session.id).toBe(firstSession.id);

    const secondSerialStart = await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: { ...startPayload, serialNo: 'S002' }
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
      payload: startPayload
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
    const start = await app.inject({
      method: 'POST',
      url: `/api/assembly/lots/${lot.id}/serials/${firstSerial.id}/start`,
      headers,
      payload: {}
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
      payload: {}
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

  it('verifies the shared 2520 password before assembly procedure order settings', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey, 'Content-Type': 'application/json' };

    const failed = await app.inject({
      method: 'POST',
      url: '/api/kiosk/assembly/procedure-order-settings/verify-access-password',
      headers,
      payload: { password: '0000' }
    });
    expect(failed.statusCode).toBe(200);
    expect(failed.json()).toEqual({ success: false });

    const succeeded = await app.inject({
      method: 'POST',
      url: '/api/kiosk/assembly/procedure-order-settings/verify-access-password',
      headers,
      payload: { password: '2520' }
    });
    expect(succeeded.statusCode).toBe(200);
    expect(succeeded.json()).toEqual({ success: true });
  });

  it('saves procedure order settings with password verification and resolves a work-session page sequence', async () => {
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

    const wrongPassword = await app.inject({
      method: 'PUT',
      url: '/api/assembly/procedure-orders',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: {
        machineName: 'ｍｈ－ａｘ',
        accessPassword: '0000',
        items: [{ kioskDocumentId: docX.id, label: 'X軸' }]
      }
    });
    expect(wrongPassword.statusCode).toBe(403);

    const saved = await app.inject({
      method: 'PUT',
      url: '/api/assembly/procedure-orders',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: {
        machineName: 'ｍｈ－ａｘ',
        accessPassword: '2520',
        items: [
          { kioskDocumentId: docY.id, label: 'Y軸' },
          { kioskDocumentId: docX.id, label: 'X軸-1' }
        ]
      }
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().order).toMatchObject({
      machineName: 'MH-AX',
      machineNameKey: 'MH-AX',
      configured: true
    });
    expect(saved.json().order.items.map((item: { label: string; kioskDocumentId: string; sortOrder: number }) => item)).toEqual([
      expect.objectContaining({ kioskDocumentId: docY.id, label: 'Y軸', sortOrder: 0 }),
      expect.objectContaining({ kioskDocumentId: docX.id, label: 'X軸-1', sortOrder: 1 })
    ]);

    const fetched = await app.inject({
      method: 'GET',
      url: '/api/assembly/procedure-orders?machineName=mh-ax',
      headers
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().order.items.map((item: { kioskDocumentId: string }) => item.kioskDocumentId)).toEqual([
      docY.id,
      docX.id
    ]);

    const startRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: {
        templateId,
        productNo: 'ASM-PDF-001',
        serialNo: 'S001',
        operatorNameSnapshot: '佐藤',
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
        operatorNameSnapshot: '佐藤',
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
      mode: 'fallback',
      reason: 'not_configured',
      machineNameKey: 'NO-ORDER',
      fallbackProcedureDocument: expect.objectContaining({ id: procedureDocumentId })
    });
  });

  it('rejects deleting a KioskDocument while it is used by an assembly procedure order', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey, 'Content-Type': 'application/json' };
    const doc = await createKioskDocumentWithRenderedPages({ title: '削除保護', pageCount: 1 });

    const saved = await app.inject({
      method: 'PUT',
      url: '/api/assembly/procedure-orders',
      headers,
      payload: {
        machineName: 'MH-LOCK',
        accessPassword: '2520',
        items: [{ kioskDocumentId: doc.id, label: '保護対象' }]
      }
    });
    expect(saved.statusCode).toBe(200);

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

  it('saves assembly procedure documents in procedure order settings and resolves them in work-session sequence', async () => {
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

    const saved = await app.inject({
      method: 'PUT',
      url: '/api/assembly/procedure-orders',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: {
        machineName: 'MH-AX',
        accessPassword: '2520',
        items: [{ assemblyProcedureDocumentId: procedureDocument.id, label: '組立手順' }]
      }
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().order.items).toEqual([
      expect.objectContaining({
        documentType: 'assembly_procedure_document',
        assemblyProcedureDocumentId: procedureDocument.id,
        kioskDocumentId: null,
        label: '組立手順',
        document: expect.objectContaining({
          documentType: 'assembly_procedure_document',
          title: procedureDocument.name,
          imageRelativePath: procedureDocument.imageRelativePath
        })
      })
    ]);

    const fetched = await app.inject({
      method: 'GET',
      url: '/api/assembly/procedure-orders?machineName=MH-AX',
      headers
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().order.items[0]).toMatchObject({
      assemblyProcedureDocumentId: procedureDocument.id,
      documentType: 'assembly_procedure_document'
    });

    const startRes = await app.inject({
      method: 'POST',
      url: '/api/assembly/work-sessions',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: {
        templateId,
        productNo: 'ASM-PROC-001',
        serialNo: 'S001',
        operatorNameSnapshot: '佐藤',
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

  it('rejects deleting an AssemblyProcedureDocument while it is used by an assembly procedure order', async () => {
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

    const saved = await app.inject({
      method: 'PUT',
      url: '/api/assembly/procedure-orders',
      headers,
      payload: {
        machineName: 'MH-LOCK-PROC',
        accessPassword: '2520',
        items: [{ assemblyProcedureDocumentId: procedureDocumentId, label: '保護対象' }]
      }
    });
    expect(saved.statusCode).toBe(200);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/assembly/procedure-documents/${procedureDocumentId}`,
      headers: { 'x-client-key': client.apiKey }
    });
    expect(deleted.statusCode).toBe(409);
    expect(deleted.json()).toMatchObject({
      message: '組立の閲覧順設定で使用中の手順書は削除できません'
    });
  });

  it('rejects procedure order items that specify both or neither document reference', async () => {
    const client = await createTestClientDevice();
    const headers = { 'x-client-key': client.apiKey, 'Content-Type': 'application/json' };
    const doc = await createKioskDocumentWithRenderedPages({ title: '両方指定', pageCount: 1 });

    const both = await app.inject({
      method: 'PUT',
      url: '/api/assembly/procedure-orders',
      headers,
      payload: {
        machineName: 'MH-INVALID',
        accessPassword: '2520',
        items: [{ kioskDocumentId: doc.id, assemblyProcedureDocumentId: doc.id, label: 'invalid' }]
      }
    });
    expect(both.statusCode).toBe(400);

    const neither = await app.inject({
      method: 'PUT',
      url: '/api/assembly/procedure-orders',
      headers,
      payload: {
        machineName: 'MH-INVALID',
        accessPassword: '2520',
        items: [{ label: 'invalid' }]
      }
    });
    expect(neither.statusCode).toBe(400);
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
        operatorNameSnapshot: '作業者A',
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
        operatorNameSnapshot: '作業者B',
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

      const orderSaveDraft = await app.inject({
        method: 'PUT',
        url: '/api/assembly/procedure-orders',
        headers,
        payload: {
          machineName: 'UWF-P2',
          accessPassword: '2520',
          items: [{ assemblyProcedureDocumentId: draftDocumentId, label: '下書き' }]
        }
      });
      expect(orderSaveDraft.statusCode).toBe(400);

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
          operatorNameSnapshot: '佐藤',
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

      await app.inject({
        method: 'PUT',
        url: '/api/assembly/procedure-orders',
        headers,
        payload: {
          machineName: 'UWF-SEQ',
          accessPassword: '2520',
          items: [{ assemblyProcedureDocumentId: publishedDoc.id, label: '公開' }]
        }
      });

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
          operatorNameSnapshot: '佐藤',
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
          operatorNameSnapshot: '佐藤',
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
  });
});
