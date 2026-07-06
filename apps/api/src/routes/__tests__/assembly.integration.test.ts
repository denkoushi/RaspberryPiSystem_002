import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
  SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL
} from '../../services/production-schedule/constants.js';
import { createTestClientDevice } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';
process.env.PHOTO_STORAGE_DIR ??= '/tmp/test-assembly-torque';
process.env.SIGNAGE_RENDER_DIR ??= '/tmp/test-assembly-torque/signage';

const MIN_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

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

async function cleanAssemblyTables() {
  await prisma.assemblyAreaRestartLog.deleteMany({});
  await prisma.assemblyTorqueRecord.deleteMany({});
  await prisma.assemblyWorkSession.deleteMany({});
  await prisma.assemblyTemplateBolt.deleteMany({});
  await prisma.assemblyTemplateArea.deleteMany({});
  await prisma.assemblyTemplate.deleteMany({});
  await prisma.assemblyProcedureDocument.deleteMany({});
  await prisma.clientDevice.deleteMany({ where: { name: { startsWith: 'Test Client ' } } });
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
      headers
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
  });
});
