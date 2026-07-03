import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
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
});
