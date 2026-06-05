import { execFile } from 'child_process';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { promisify } from 'util';

import { buildServer } from '../../app.js';
import { buildMinimalValidPdfBuffer } from '../../lib/__tests__/fixtures/minimal-pdf.js';
import * as drawingImport from '../../lib/part-measurement-drawing-import.js';
import { prisma } from '../../lib/prisma.js';
import { PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD } from '../../services/part-measurement/part-measurement-constants.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../services/production-schedule/constants.js';
import { SelfInspectionService } from '../../services/part-measurement/self-inspection.service.js';
import { createAuthHeader, createTestClientDevice, createTestEmployee, createTestUser } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

async function cleanPartMeasurementTables() {
  await prisma.selfInspectionMeasurementValue.deleteMany({});
  await prisma.selfInspectionLotEntry.deleteMany({});
  await prisma.selfInspectionSessionResetAuditLog.deleteMany({});
  await prisma.selfInspectionSession.deleteMany({});
  await prisma.partMeasurementResult.deleteMany({});
  await prisma.partMeasurementSheet.deleteMany({});
  await prisma.partMeasurementSession.deleteMany({});
  await prisma.partMeasurementTemplate.deleteMany({});
  await prisma.partMeasurementVisualTemplate.deleteMany({});
}

/** 1x1 PNG */
const MIN_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_SOURCE_DASHBOARD_ID = '8f0b8d6e-4b77-4e7e-8d9a-6c8b2f5d1a31';

async function seedProductionScheduleRow(input: {
  productNo: string;
  fseiban: string;
  fhincd: string;
  resourceCd: string;
  plannedQuantity?: number;
}): Promise<string> {
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
      dedupKeyColumns: ['ProductNo'],
      dateColumnName: 'registeredAt',
      enabled: true
    }
  });
  const row = await prisma.csvDashboardRow.create({
    data: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      occurredAt: new Date(),
      dataHash: `self-inspection-${Date.now()}-${Math.random()}`,
      rowData: {
        ProductNo: input.productNo,
        FSEIBAN: input.fseiban,
        FHINCD: input.fhincd,
        FSIGENCD: input.resourceCd,
        FHINMEI: '自主検査品'
      }
    }
  });
  const plannedQuantity = input.plannedQuantity ?? 5;
  const supplementProductNo = input.productNo.slice(0, 20);
  const supplementResourceCd = input.resourceCd.slice(0, 20);
  await prisma.productionScheduleOrderSupplement.upsert({
    where: { csvDashboardRowId: row.id },
    update: { plannedQuantity },
    create: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      csvDashboardRowId: row.id,
      sourceCsvDashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_SOURCE_DASHBOARD_ID,
      productNo: supplementProductNo,
      resourceCd: supplementResourceCd,
      processOrder: '10',
      plannedQuantity
    }
  });
  return row.id;
}

function buildMultipartPng(name: string, png: Buffer): { body: Buffer; contentType: string } {
  return buildMultipartDrawingFile(name, png, { filename: 't.png', contentType: 'image/png' });
}

const MIN_PDF = buildMinimalValidPdfBuffer();

function buildMultipartDrawingFile(
  name: string,
  fileBuffer: Buffer,
  opts: { filename: string; contentType: string }
): { body: Buffer; contentType: string } {
  const boundary = `----testPmDraw${Date.now()}`;
  const crlf = '\r\n';
  const parts: Buffer[] = [];
  const push = (s: string) => parts.push(Buffer.from(s, 'utf8'));
  push(`--${boundary}${crlf}`);
  push(`Content-Disposition: form-data; name="name"${crlf}${crlf}${name}${crlf}`);
  push(`--${boundary}${crlf}`);
  push(
    `Content-Disposition: form-data; name="file"; filename="${opts.filename}"${crlf}Content-Type: ${opts.contentType}${crlf}${crlf}`
  );
  parts.push(fileBuffer);
  push(`${crlf}--${boundary}--${crlf}`);
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

function buildMultipartPdf(name: string, pdf: Buffer, contentType = 'application/pdf') {
  return buildMultipartDrawingFile(name, pdf, { filename: 'drawing.pdf', contentType });
}

function buildMultipartEvaluationTemplate(opts: {
  name?: string;
  referenceFhincd: string;
  referenceResourceCd: string;
  referenceProcessGroup?: string;
  itemsJson: string;
  fileBuffer: Buffer;
  filename: string;
  contentType: string;
}): { body: Buffer; contentType: string } {
  const boundary = `----testPmEval${Date.now()}`;
  const crlf = '\r\n';
  const parts: Buffer[] = [];
  const push = (s: string) => parts.push(Buffer.from(s, 'utf8'));
  const name = opts.name ?? 'eval-multipart';
  push(`--${boundary}${crlf}`);
  push(`Content-Disposition: form-data; name="name"${crlf}${crlf}${name}${crlf}`);
  push(`--${boundary}${crlf}`);
  push(
    `Content-Disposition: form-data; name="referenceFhincd"${crlf}${crlf}${opts.referenceFhincd}${crlf}`
  );
  push(`--${boundary}${crlf}`);
  push(
    `Content-Disposition: form-data; name="referenceResourceCd"${crlf}${crlf}${opts.referenceResourceCd}${crlf}`
  );
  push(`--${boundary}${crlf}`);
  push(
    `Content-Disposition: form-data; name="referenceProcessGroup"${crlf}${crlf}${opts.referenceProcessGroup ?? 'cutting'}${crlf}`
  );
  push(`--${boundary}${crlf}`);
  push(`Content-Disposition: form-data; name="items"${crlf}${crlf}${opts.itemsJson}${crlf}`);
  push(`--${boundary}${crlf}`);
  push(
    `Content-Disposition: form-data; name="file"; filename="${opts.filename}"${crlf}Content-Type: ${opts.contentType}${crlf}${crlf}`
  );
  parts.push(opts.fileBuffer);
  push(`${crlf}--${boundary}--${crlf}`);
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

const execFileAsync = promisify(execFile);

describe('part-measurement templates API', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    await cleanPartMeasurementTables();
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
    const viewer = await createTestUser('VIEWER');
    viewerToken = viewer.token;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('returns 401 without auth for GET /api/part-measurement/templates', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/part-measurement/templates' });
    expect(response.statusCode).toBe(401);
  });

  it('returns 401 without auth for GET /api/part-measurement/visual-templates', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/part-measurement/visual-templates' });
    expect(response.statusCode).toBe(401);
  });

  it('creates visual template with PNG (ADMIN) and binds business template', async () => {
    const { body, contentType } = buildMultipartPng('図面A', MIN_PNG);
    const up = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/visual-templates',
      headers: { ...createAuthHeader(adminToken), 'content-type': contentType },
      payload: body
    });
    expect(up.statusCode).toBe(200);
    const vid = up.json().visualTemplate.id as string;
    expect(vid).toBeTruthy();
    expect(up.json().visualTemplate.drawingImageRelativePath).toMatch(/part-measurement-drawings/);

    const fhincd = `VT-${Date.now()}`;
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-V1',
        name: 'with visual',
        visualTemplateId: vid,
        items: [
          {
            sortOrder: 0,
            datumSurface: 'A',
            measurementPoint: 'B',
            measurementLabel: 'L1',
            displayMarker: '5',
            markerXRatio: 0.25,
            markerYRatio: 0.75,
            nominalValue: 20,
            lowerLimit: 19.98,
            upperLimit: 20.02
          }
        ]
      }
    });
    expect(createRes.statusCode).toBe(200);
    const tpl = createRes.json().template;
    expect(tpl.visualTemplateId).toBe(vid);
    expect(tpl.visualTemplate?.id).toBe(vid);
    expect(tpl.items[0].displayMarker).toBe('5');
    expect(tpl.items[0].markerXRatio).toBe('0.25');
    expect(tpl.items[0].markerYRatio).toBe('0.75');
    expect(tpl.items[0].nominalValue).toBe('20');
    expect(tpl.items[0].lowerLimit).toBe('19.98');
    expect(tpl.items[0].upperLimit).toBe('20.02');

    const kioskGet = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/inspection-drawing/templates/${tpl.id}`,
      headers: createAuthHeader(viewerToken)
    });
    expect(kioskGet.statusCode).toBe(200);
    expect(kioskGet.json().template.id).toBe(tpl.id);

    const kioskList = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/inspection-drawing/templates?fhincd=${encodeURIComponent(fhincd.slice(0, 4))}`,
      headers: createAuthHeader(viewerToken)
    });
    expect(kioskList.statusCode).toBe(200);
    const listed = kioskList.json().templates as Array<{ id: string; itemCount: number; items?: unknown[] }>;
    expect(listed.some((row) => row.id === tpl.id)).toBe(true);
    expect(listed.find((row) => row.id === tpl.id)?.itemCount).toBe(1);
    expect(listed[0]?.items).toBeUndefined();

    const noMarkerRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd: `NM-${Date.now()}`,
        processGroup: 'cutting',
        resourceCd: 'RES-NM',
        name: 'no markers',
        visualTemplateId: vid,
        items: [
          {
            sortOrder: 0,
            datumSurface: 'A',
            measurementPoint: 'B',
            measurementLabel: 'L1'
          }
        ]
      }
    });
    expect(noMarkerRes.statusCode).toBe(200);
    const noMarkerTpl = noMarkerRes.json().template;
    const kioskReject = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/inspection-drawing/templates/${noMarkerTpl.id}`,
      headers: createAuthHeader(viewerToken)
    });
    expect(kioskReject.statusCode).toBe(409);

    const reviseRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/templates/${tpl.id}/revise`,
      headers: createAuthHeader(adminToken),
      payload: {
        name: 'with visual v2',
        visualTemplateId: vid,
        items: [
          {
            sortOrder: 0,
            datumSurface: 'A',
            measurementPoint: 'B',
            measurementLabel: 'L1',
            markerXRatio: 0.3,
            markerYRatio: 0.7,
            nominalValue: 20,
            lowerLimit: 19.98,
            upperLimit: 20.02
          }
        ]
      }
    });
    expect(reviseRes.statusCode).toBe(200);
    const oldId = tpl.id;
    const inactiveRevise = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/inspection-drawing/templates/${oldId}/revise`,
      headers: createAuthHeader(adminToken),
      payload: {
        name: 'blocked on inactive',
        visualTemplateId: vid,
        items: [
          {
            sortOrder: 0,
            datumSurface: 'A',
            measurementPoint: 'B',
            measurementLabel: 'L1',
            markerXRatio: 0.25,
            markerYRatio: 0.75,
            nominalValue: 20,
            lowerLimit: 19.98,
            upperLimit: 20.02
          }
        ]
      }
    });
    expect(inactiveRevise.statusCode).toBe(409);
  });

  it('inspection-drawing evaluation template save does not deactivate production THREE_KEY template', async () => {
    const fhincd = `EVAL-PROD-${Date.now()}`;
    const resourceCd = 'RES-EVAL-1';
    const prodRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd,
        name: 'production active',
        items: [
          {
            sortOrder: 0,
            datumSurface: 'A',
            measurementPoint: 'B',
            measurementLabel: 'L1'
          }
        ]
      }
    });
    expect(prodRes.statusCode).toBe(200);
    const prodId = prodRes.json().template.id as string;

    const { body, contentType } = buildMultipartPng('eval drawing', MIN_PNG);
    const up = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/visual-templates',
      headers: { ...createAuthHeader(adminToken), 'content-type': contentType },
      payload: body
    });
    expect(up.statusCode).toBe(200);
    const vid = up.json().visualTemplate.id as string;

    const evalRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/inspection-drawing/evaluation-templates',
      headers: createAuthHeader(adminToken),
      payload: {
        referenceFhincd: fhincd,
        referenceResourceCd: resourceCd,
        referenceProcessGroup: 'cutting',
        name: 'eval only',
        visualTemplateId: vid,
        items: [
          {
            sortOrder: 0,
            datumSurface: 'A',
            measurementPoint: 'B',
            measurementLabel: 'L1',
            markerXRatio: 0.1,
            markerYRatio: 0.2,
            nominalValue: 1,
            lowerLimit: 0.9,
            upperLimit: 1.1
          }
        ]
      }
    });
    expect(evalRes.statusCode).toBe(200);
    const evalTpl = evalRes.json().template;
    const evalSheetFromCreate = evalRes.json().sheet;
    expect(evalTpl.fhincd).toBe(PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD);
    expect(evalSheetFromCreate.templateId).toBe(evalTpl.id);
    expect(evalSheetFromCreate.quantity).toBe(1);
    expect(evalTpl.processGroup).toBeNull();
    expect(evalTpl.isActive).toBe(true);

    const prodAfter = await prisma.partMeasurementTemplate.findUnique({ where: { id: prodId } });
    expect(prodAfter?.isActive).toBe(true);
    expect(prodAfter?.fhincd).toBe(fhincd);
    expect(prodAfter?.resourceCd).toBe(resourceCd);
  });

  it('excludes inspection-drawing evaluation templates from GET /templates list', async () => {
    const fhincd = `EVAL-LIST-${Date.now()}`;
    const { body, contentType } = buildMultipartPng('eval drawing', MIN_PNG);
    const up = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/visual-templates',
      headers: { ...createAuthHeader(adminToken), 'content-type': contentType },
      payload: body
    });
    const vid = up.json().visualTemplate.id as string;

    const evalRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/inspection-drawing/evaluation-templates',
      headers: createAuthHeader(adminToken),
      payload: {
        referenceFhincd: fhincd,
        referenceResourceCd: 'RES-L',
        referenceProcessGroup: 'cutting',
        name: 'eval list',
        visualTemplateId: vid,
        items: [
          {
            sortOrder: 0,
            datumSurface: 'A',
            measurementPoint: 'B',
            measurementLabel: 'L1'
          }
        ]
      }
    });
    expect(evalRes.statusCode).toBe(200);
    const evalId = evalRes.json().template.id as string;

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken)
    });
    expect(listRes.statusCode).toBe(200);
    const ids = (listRes.json().templates as { id: string }[]).map((t) => t.id);
    expect(ids).not.toContain(evalId);
  });

  it('creates evaluation draft sheet with template and blocks production sheet APIs', async () => {
    const fhincd = `EVAL-SHEET-CREATE-${Date.now()}`;
    const { body, contentType } = buildMultipartPng('eval drawing', MIN_PNG);
    const up = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/visual-templates',
      headers: { ...createAuthHeader(adminToken), 'content-type': contentType },
      payload: body
    });
    const vid = up.json().visualTemplate.id as string;

    const evalRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/inspection-drawing/evaluation-templates',
      headers: createAuthHeader(adminToken),
      payload: {
        referenceFhincd: fhincd,
        referenceResourceCd: 'RES-EVAL-SHEET',
        referenceProcessGroup: 'cutting',
        name: 'eval sheet flow',
        visualTemplateId: vid,
        items: [
          {
            sortOrder: 0,
            datumSurface: 'A',
            measurementPoint: 'B',
            measurementLabel: 'L1',
            markerXRatio: 0.1,
            markerYRatio: 0.2,
            nominalValue: 1,
            lowerLimit: 0.9,
            upperLimit: 1.1
          }
        ]
      }
    });
    expect(evalRes.statusCode).toBe(200);
    const templateId = evalRes.json().template.id as string;
    const sheet = evalRes.json().sheet;
    expect(sheet.quantity).toBe(1);
    expect(sheet.templateId).toBe(templateId);
    expect(sheet.fhincd).toBe(PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD);

    const itemId = evalRes.json().template.items[0].id as string;
    const evalPatch = await app.inject({
      method: 'PATCH',
      url: `/api/part-measurement/inspection-drawing/evaluation-sheets/${sheet.id}`,
      headers: createAuthHeader(adminToken),
      payload: {
        results: [{ pieceIndex: 0, templateItemId: itemId, value: '1.0' }]
      }
    });
    expect(evalPatch.statusCode).toBe(200);

    const prodPatch = await app.inject({
      method: 'PATCH',
      url: `/api/part-measurement/sheets/${sheet.id}`,
      headers: createAuthHeader(adminToken),
      payload: { quantity: 1 }
    });
    expect(prodPatch.statusCode).toBe(409);

    const prodFinalize = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/sheets/${sheet.id}/finalize`,
      headers: createAuthHeader(adminToken)
    });
    expect(prodFinalize.statusCode).toBe(409);
  });

  it('excludes evaluation sheets from GET /sheets/drafts', async () => {
    const fhincd = `EVAL-DRAFT-LIST-${Date.now()}`;
    const { body, contentType } = buildMultipartPng('eval drawing', MIN_PNG);
    const up = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/visual-templates',
      headers: { ...createAuthHeader(adminToken), 'content-type': contentType },
      payload: body
    });
    const vid = up.json().visualTemplate.id as string;

    const evalRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/inspection-drawing/evaluation-templates',
      headers: createAuthHeader(adminToken),
      payload: {
        referenceFhincd: fhincd,
        referenceResourceCd: 'RES-DRAFT-LIST',
        referenceProcessGroup: 'cutting',
        name: 'eval draft list',
        visualTemplateId: vid,
        items: [{ sortOrder: 0, datumSurface: 'A', measurementPoint: 'B', measurementLabel: 'L1' }]
      }
    });
    expect(evalRes.statusCode).toBe(200);
    const evalSheetId = evalRes.json().sheet.id as string;

    const prodFhincd = `PROD-DRAFT-LIST-${Date.now()}`;
    const t1 = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd: prodFhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-PDL',
        name: 'prod draft list',
        items: [{ sortOrder: 0, datumSurface: 'A', measurementPoint: 'B', measurementLabel: 'L1' }]
      }
    });
    const prodSheet = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/sheets',
      headers: createAuthHeader(adminToken),
      payload: {
        productNo: `PN-PDL-${Date.now()}`,
        fseiban: 'FS-PDL',
        fhincd: prodFhincd,
        fhinmei: '品',
        resourceCdSnapshot: 'RES-PDL',
        processGroup: 'cutting',
        templateId: t1.json().template.id
      }
    });
    expect(prodSheet.statusCode).toBe(200);
    const prodSheetId = prodSheet.json().sheet.id as string;

    const draftsRes = await app.inject({
      method: 'GET',
      url: '/api/part-measurement/sheets/drafts?limit=50',
      headers: createAuthHeader(adminToken)
    });
    expect(draftsRes.statusCode).toBe(200);
    const draftIds = (draftsRes.json().sheets as { id: string }[]).map((s) => s.id);
    expect(draftIds).toContain(prodSheetId);
    expect(draftIds).not.toContain(evalSheetId);
  });

  it('allows production drawing sheet patch and finalize via normal sheet APIs when quantity is 1', async () => {
    const employee = await createTestEmployee({
      displayName: 'Inspection Drawing Tester',
      nfcTagUid: `TAG-PD-${Date.now()}`
    });
    const { body, contentType } = buildMultipartPng('prod drawing', MIN_PNG);
    const up = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/visual-templates',
      headers: { ...createAuthHeader(adminToken), 'content-type': contentType },
      payload: body
    });
    const vid = up.json().visualTemplate.id as string;
    const fhincd = `PROD-DRAW-${Date.now()}`;
    const tRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-PD',
        name: 'prod drawing tpl',
        visualTemplateId: vid,
        items: [
          {
            sortOrder: 0,
            datumSurface: 'A',
            measurementPoint: 'B',
            measurementLabel: 'L1',
            markerXRatio: 0.1,
            markerYRatio: 0.2,
            nominalValue: 0,
            lowerLimit: 0,
            upperLimit: 1
          }
        ]
      }
    });
    const templateId = tRes.json().template.id as string;
    const itemId = tRes.json().template.items[0].id as string;
    const sheetRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/sheets',
      headers: createAuthHeader(adminToken),
      payload: {
        productNo: `PN-PD-${Date.now()}`,
        fseiban: 'FS',
        fhincd,
        fhinmei: '品',
        resourceCdSnapshot: 'RES-PD',
        processGroup: 'cutting',
        templateId
      }
    });
    const sheetId = sheetRes.json().sheet.id as string;

    const setQty = await app.inject({
      method: 'PATCH',
      url: `/api/part-measurement/sheets/${sheetId}`,
      headers: createAuthHeader(adminToken),
      payload: { quantity: 1, results: [{ pieceIndex: 0, templateItemId: itemId, value: '0.5' }] }
    });
    expect(setQty.statusCode).toBe(200);

    const clearValue = await app.inject({
      method: 'PATCH',
      url: `/api/part-measurement/sheets/${sheetId}`,
      headers: createAuthHeader(adminToken),
      payload: { results: [{ pieceIndex: 0, templateItemId: itemId, value: null }] }
    });
    expect(clearValue.statusCode).toBe(200);
    const afterClear = await prisma.partMeasurementResult.findFirst({
      where: { sheetId, templateItemId: itemId, pieceIndex: 0 }
    });
    expect(afterClear).toBeNull();

    await app.inject({
      method: 'PATCH',
      url: `/api/part-measurement/sheets/${sheetId}`,
      headers: createAuthHeader(adminToken),
      payload: { results: [{ pieceIndex: 0, templateItemId: itemId, value: '0.5' }] }
    });

    const tagRes = await app.inject({
      method: 'PATCH',
      url: `/api/part-measurement/sheets/${sheetId}`,
      headers: createAuthHeader(adminToken),
      payload: { employeeTagUid: employee.nfcTagUid }
    });
    expect(tagRes.statusCode).toBe(200);

    const evalPatch = await app.inject({
      method: 'PATCH',
      url: `/api/part-measurement/inspection-drawing/evaluation-sheets/${sheetId}`,
      headers: createAuthHeader(adminToken),
      payload: { results: [{ pieceIndex: 0, templateItemId: itemId, value: '0.6' }] }
    });
    expect(evalPatch.statusCode).toBe(409);

    const finalizeRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/sheets/${sheetId}/finalize`,
      headers: createAuthHeader(adminToken)
    });
    expect(finalizeRes.statusCode).toBe(200);
    expect(finalizeRes.json().sheet.status).toBe('FINALIZED');
  });

  it('creates quantity 1 draft immediately for production drawing templates', async () => {
    const { body, contentType } = buildMultipartPng('prod drawing default qty', MIN_PNG);
    const up = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/visual-templates',
      headers: { ...createAuthHeader(adminToken), 'content-type': contentType },
      payload: body
    });
    expect(up.statusCode).toBe(200);
    const vid = up.json().visualTemplate.id as string;
    const fhincd = `PROD-DRAW-DEFAULT-${Date.now()}`;
    const templateRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-PDD',
        name: 'prod drawing default qty',
        visualTemplateId: vid,
        items: [
          {
            sortOrder: 0,
            datumSurface: 'A',
            measurementPoint: 'B',
            measurementLabel: 'L1',
            markerXRatio: 0.1,
            markerYRatio: 0.2,
            nominalValue: 0,
            lowerLimit: 0,
            upperLimit: 1
          }
        ]
      }
    });
    expect(templateRes.statusCode).toBe(200);

    const sheetRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/sheets',
      headers: createAuthHeader(adminToken),
      payload: {
        productNo: `PN-PDD-${Date.now()}`,
        fseiban: 'FS-PDD',
        fhincd,
        fhinmei: '品',
        resourceCdSnapshot: 'RES-PDD',
        processGroup: 'cutting',
        templateId: templateRes.json().template.id
      }
    });
    expect(sheetRes.statusCode).toBe(200);
    expect(sheetRes.json().sheet.quantity).toBe(1);
  });

  it('rejects inspection-drawing evaluation-sheet patch for production template sheet', async () => {
    const fhincd = `EVAL-SHEET-PROD-${Date.now()}`;
    const t1 = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-ES',
        name: 'prod for eval guard',
        items: [
          {
            sortOrder: 0,
            datumSurface: 'A',
            measurementPoint: 'B',
            measurementLabel: 'L1',
            markerXRatio: 0.1,
            markerYRatio: 0.2,
            lowerLimit: 0,
            upperLimit: 1
          }
        ]
      }
    });
    const templateId = t1.json().template.id as string;
    const sheetRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/sheets',
      headers: createAuthHeader(adminToken),
      payload: {
        productNo: `PN-ES-${Date.now()}`,
        fseiban: 'FS-ES',
        fhincd,
        fhinmei: '品',
        resourceCdSnapshot: 'RES-ES',
        processGroup: 'cutting',
        templateId
      }
    });
    expect(sheetRes.statusCode).toBe(200);
    const sheetId = sheetRes.json().sheet.id as string;

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/part-measurement/inspection-drawing/evaluation-sheets/${sheetId}`,
      headers: createAuthHeader(adminToken),
      payload: {
        results: [{ pieceIndex: 0, templateItemId: t1.json().template.items[0].id, value: '0.5' }]
      }
    });
    expect(patchRes.statusCode).toBe(409);

    const finalizeRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/inspection-drawing/evaluation-sheets/${sheetId}/finalize`,
      headers: createAuthHeader(adminToken)
    });
    expect(finalizeRes.statusCode).toBe(409);
  });

  it('rejects clone-for-schedule-key when source is inspection-drawing evaluation template', async () => {
    const { body, contentType } = buildMultipartPng('eval drawing', MIN_PNG);
    const up = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/visual-templates',
      headers: { ...createAuthHeader(adminToken), 'content-type': contentType },
      payload: body
    });
    const vid = up.json().visualTemplate.id as string;

    const evalRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/inspection-drawing/evaluation-templates',
      headers: createAuthHeader(adminToken),
      payload: {
        referenceFhincd: 'FH-CLONE',
        referenceResourceCd: 'RC',
        referenceProcessGroup: 'cutting',
        name: 'eval clone',
        visualTemplateId: vid,
        items: [
          {
            sortOrder: 0,
            datumSurface: 'A',
            measurementPoint: 'B',
            measurementLabel: 'L1'
          }
        ]
      }
    });
    const evalId = evalRes.json().template.id as string;

    const cloneRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates/clone-for-schedule-key',
      headers: createAuthHeader(adminToken),
      payload: {
        sourceTemplateId: evalId,
        fhincd: 'FH-TARGET',
        processGroup: 'cutting',
        resourceCd: 'RC-T'
      }
    });
    expect(cloneRes.statusCode).toBe(409);
  });

  it('returns 401 without auth for POST /api/part-measurement/templates', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      payload: { fhincd: 'X', processGroup: 'cutting', resourceCd: 'RC1', name: 'n', items: [] }
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 409 for failIfActiveExists when fhincd differs only by case', async () => {
    const fhincd = `CASE-${Date.now()}`;
    const payload = {
      fhincd,
      processGroup: 'cutting',
      resourceCd: 'RES-CASE',
      name: '大文字小文字衝突',
      items: [
        {
          sortOrder: 0,
          datumSurface: 'A',
          measurementPoint: 'B',
          measurementLabel: 'L1'
        }
      ]
    };

    const first = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        ...payload,
        fhincd: fhincd.toLowerCase(),
        name: '小文字で新規',
        failIfActiveExists: true
      }
    });
    expect(second.statusCode).toBe(409);
  });

  it('returns 409 when failIfActiveExists and active template already exists', async () => {
    const fhincd = `COLL-${Date.now()}`;
    const payload = {
      fhincd,
      processGroup: 'cutting',
      resourceCd: 'RES-COLL',
      name: '衝突テスト',
      items: [
        {
          sortOrder: 0,
          datumSurface: 'A',
          measurementPoint: 'B',
          measurementLabel: 'L1'
        }
      ]
    };

    const first = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: { ...payload, name: '衝突テスト2', failIfActiveExists: true }
    });
    expect(second.statusCode).toBe(409);
  });

  it('serializes concurrent failIfActiveExists creates so only one succeeds and one active remains', async () => {
    const fhincd = `CONC-${Date.now()}`;
    const resourceCd = 'RES-CONC';
    const basePayload = {
      fhincd,
      processGroup: 'cutting',
      resourceCd,
      failIfActiveExists: true,
      items: [
        {
          sortOrder: 0,
          datumSurface: 'A',
          measurementPoint: 'B',
          measurementLabel: 'L1'
        }
      ]
    };

    const [first, second] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/part-measurement/templates',
        headers: createAuthHeader(adminToken),
        payload: { ...basePayload, name: '同時作成A' }
      }),
      app.inject({
        method: 'POST',
        url: '/api/part-measurement/templates',
        headers: createAuthHeader(adminToken),
        payload: { ...basePayload, name: '同時作成B' }
      })
    ]);

    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);

    const activeCount = await prisma.partMeasurementTemplate.count({
      where: {
        fhincd,
        processGroup: 'CUTTING',
        resourceCd,
        isActive: true,
        templateScope: 'THREE_KEY'
      }
    });
    expect(activeCount).toBe(1);

    const totalCount = await prisma.partMeasurementTemplate.count({
      where: {
        fhincd,
        processGroup: 'CUTTING',
        resourceCd,
        templateScope: 'THREE_KEY'
      }
    });
    expect(totalCount).toBe(1);
  });

  it('reports active template existence without loading full template payload', async () => {
    const fhincd = `EXISTS-${Date.now()}`;
    const resourceCd = 'RES-EXISTS';
    const missing = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/templates/active-exists?fhincd=${fhincd}&processGroup=cutting&resourceCd=${resourceCd}`,
      headers: createAuthHeader(adminToken)
    });
    expect(missing.statusCode).toBe(200);
    expect(missing.json()).toEqual({ exists: false });

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd,
        name: '存在確認テスト',
        items: [
          {
            sortOrder: 0,
            datumSurface: 'A',
            measurementPoint: 'B',
            measurementLabel: 'L1'
          }
        ]
      }
    });
    expect(createRes.statusCode).toBe(200);

    const found = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/templates/active-exists?fhincd=${fhincd}&processGroup=cutting&resourceCd=${resourceCd}`,
      headers: createAuthHeader(adminToken)
    });
    expect(found.statusCode).toBe(200);
    expect(found.json()).toEqual({ exists: true });

    const mixedCase = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/templates/active-exists?fhincd=${encodeURIComponent(fhincd.toLowerCase())}&processGroup=cutting&resourceCd=${resourceCd}`,
      headers: createAuthHeader(adminToken)
    });
    expect(mixedCase.statusCode).toBe(200);
    expect(mixedCase.json()).toEqual({ exists: true });
  });

  it('creates and lists active template (ADMIN)', async () => {
    const fhincd = `T-${Date.now()}`;
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-1',
        name: 'テストテンプレ',
        items: [
          {
            sortOrder: 0,
            datumSurface: 'A',
            measurementPoint: 'B',
            measurementLabel: 'L1',
            unit: 'mm',
            allowNegative: false
          }
        ]
      }
    });
    expect(createRes.statusCode).toBe(200);
    const created = createRes.json().template;
    expect(created.fhincd).toBe(fhincd);
    expect(created.version).toBe(1);
    expect(created.isActive).toBe(true);
    expect(created.items).toHaveLength(1);
    expect(created.items[0].displayMarker).toBeNull();
    expect(created.visualTemplateId).toBeNull();
    expect(created.visualTemplate).toBeNull();

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken)
    });
    expect(listRes.statusCode).toBe(200);
    const list = listRes.json().templates as Array<{ fhincd: string }>;
    expect(list.some((t) => t.fhincd === fhincd)).toBe(true);
  });

  it('allows VIEWER to list templates', async () => {
    const fhincd = `V-${Date.now()}`;
    await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'grinding',
        resourceCd: 'RES-G1',
        name: 'v',
        items: [
          {
            sortOrder: 0,
            datumSurface: 'a',
            measurementPoint: 'b',
            measurementLabel: 'c'
          }
        ]
      }
    });

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(viewerToken)
    });
    expect(listRes.statusCode).toBe(200);
  });

  it('rejects VIEWER for POST /api/part-measurement/templates', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(viewerToken),
      payload: {
        fhincd: 'NOPE',
        processGroup: 'cutting',
        resourceCd: 'R',
        name: 'x',
        items: [
          {
            sortOrder: 0,
            datumSurface: 'a',
            measurementPoint: 'b',
            measurementLabel: 'c'
          }
        ]
      }
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not fallback to client-key when auth role is insufficient', async () => {
    const client = await createTestClientDevice();
    const res = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/sheets',
      headers: { ...createAuthHeader(viewerToken), 'x-client-key': client.apiKey },
      payload: {
        productNo: 'PN-1',
        fseiban: 'FS-1',
        fhincd: 'FH-1',
        fhinmei: '品名',
        resourceCdSnapshot: 'RC',
        processGroup: 'cutting',
        templateId: '00000000-0000-0000-0000-000000000001'
      }
    });
    expect(res.statusCode).toBe(403);
  });

  it('activates a specific template version (ADMIN)', async () => {
    const fhincd = `ACT-${Date.now()}`;
    const first = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-ACT',
        name: 'v1',
        items: [
          {
            sortOrder: 0,
            datumSurface: 'a',
            measurementPoint: 'b',
            measurementLabel: 'c'
          }
        ]
      }
    });
    const id1 = first.json().template.id as string;

    await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-ACT',
        name: 'v2',
        items: [
          {
            sortOrder: 0,
            datumSurface: 'a2',
            measurementPoint: 'b2',
            measurementLabel: 'c2'
          }
        ]
      }
    });

    const activateRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/templates/${id1}/activate`,
      headers: createAuthHeader(adminToken)
    });
    expect(activateRes.statusCode).toBe(200);
    const body = activateRes.json().template;
    expect(body.id).toBe(id1);
    expect(body.isActive).toBe(true);
  });

  it('activate deactivates mixed-case fhincd siblings in the same THREE_KEY lineage', async () => {
    const base = `MIX-${Date.now()}`;
    const upperFhincd = base.toUpperCase();
    const lowerFhincd = base.toLowerCase();
    const resourceCd = 'RES-MIX-CASE';
    const processGroup = 'CUTTING' as const;

    const upper = await prisma.partMeasurementTemplate.create({
      data: {
        templateScope: 'THREE_KEY',
        fhincd: upperFhincd,
        processGroup,
        resourceCd,
        name: 'legacy upper',
        version: 1,
        isActive: true
      }
    });
    const lower = await prisma.partMeasurementTemplate.create({
      data: {
        templateScope: 'THREE_KEY',
        fhincd: lowerFhincd,
        processGroup,
        resourceCd,
        name: 'legacy lower',
        version: 2,
        isActive: true
      }
    });

    const activateRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/templates/${upper.id}/activate`,
      headers: createAuthHeader(adminToken)
    });
    expect(activateRes.statusCode).toBe(200);

    const upperAfter = await prisma.partMeasurementTemplate.findUnique({ where: { id: upper.id } });
    const lowerAfter = await prisma.partMeasurementTemplate.findUnique({ where: { id: lower.id } });
    expect(upperAfter?.isActive).toBe(true);
    expect(lowerAfter?.isActive).toBe(false);
  });

  it('revises active template into next version and deactivates prior (ADMIN)', async () => {
    const fhincd = `REV-${Date.now()}`;
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-REV',
        name: 'before',
        items: [
          {
            sortOrder: 0,
            datumSurface: 'a',
            measurementPoint: 'b',
            measurementLabel: 'c'
          }
        ]
      }
    });
    expect(createRes.statusCode).toBe(200);
    const id1 = createRes.json().template.id as string;
    expect(createRes.json().template.version).toBe(1);

    const reviseRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/templates/${id1}/revise`,
      headers: createAuthHeader(adminToken),
      payload: {
        name: 'after',
        visualTemplateId: null,
        items: [
          {
            sortOrder: 0,
            datumSurface: 'a2',
            measurementPoint: 'b2',
            measurementLabel: 'c2'
          }
        ]
      }
    });
    expect(reviseRes.statusCode).toBe(200);
    const id2 = reviseRes.json().template.id as string;
    expect(id2).not.toBe(id1);
    expect(reviseRes.json().template.version).toBe(2);
    expect(reviseRes.json().template.name).toBe('after');
    expect(reviseRes.json().template.isActive).toBe(true);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/part-measurement/templates?includeInactive=true',
      headers: createAuthHeader(adminToken)
    });
    expect(listRes.statusCode).toBe(200);
    const templates = listRes.json().templates as Array<{ id: string; isActive: boolean; fhincd: string }>;
    const row1 = templates.find((t) => t.id === id1);
    const row2 = templates.find((t) => t.id === id2);
    expect(row1?.isActive).toBe(false);
    expect(row2?.isActive).toBe(true);
  });

  it('revises FHINMEI_ONLY candidate key on same lineage (ADMIN)', async () => {
    const key1 = `キーA-${Date.now()}`;
    const key2 = `キーB-${Date.now()}`;
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        templateScope: 'fhinmei_only',
        fhincd: '',
        processGroup: 'cutting',
        resourceCd: '',
        candidateFhinmei: key1,
        name: 'fhinmei key edit',
        items: [
          {
            sortOrder: 0,
            datumSurface: 'd1',
            measurementPoint: 'p1',
            measurementLabel: 'l1'
          }
        ]
      }
    });
    expect(createRes.statusCode).toBe(200);
    const id1 = createRes.json().template.id as string;
    const resourceCd = createRes.json().template.resourceCd as string;

    const reviseRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/templates/${id1}/revise`,
      headers: createAuthHeader(adminToken),
      payload: {
        name: 'fhinmei key edit v2',
        candidateFhinmei: key2,
        items: [
          {
            sortOrder: 0,
            datumSurface: 'd2',
            measurementPoint: 'p2',
            measurementLabel: 'l2'
          }
        ]
      }
    });
    expect(reviseRes.statusCode).toBe(200);
    const id2 = reviseRes.json().template.id as string;
    expect(reviseRes.json().template.candidateFhinmei).toBe(key2);
    expect(reviseRes.json().template.resourceCd).toBe(resourceCd);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/part-measurement/templates?includeInactive=true',
      headers: createAuthHeader(adminToken)
    });
    const templates = listRes.json().templates as Array<{
      id: string;
      candidateFhinmei: string | null;
      isActive: boolean;
    }>;
    const active = templates.find((t) => t.id === id2);
    expect(active?.isActive).toBe(true);
    expect(active?.candidateFhinmei).toBe(key2);
  });

  it('revises FHINMEI_ONLY template on same lineage (single active) (ADMIN)', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        templateScope: 'fhinmei_only',
        fhincd: '',
        processGroup: 'cutting',
        resourceCd: '',
        candidateFhinmei: `候補キー${Date.now()}`,
        name: 'fhinmei v1',
        items: [
          {
            sortOrder: 0,
            datumSurface: 'd1',
            measurementPoint: 'p1',
            measurementLabel: 'l1'
          }
        ]
      }
    });
    expect(createRes.statusCode).toBe(200);
    const id1 = createRes.json().template.id as string;
    const resourceCd = createRes.json().template.resourceCd as string;

    const reviseRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/templates/${id1}/revise`,
      headers: createAuthHeader(adminToken),
      payload: {
        name: 'fhinmei v2',
        items: [
          {
            sortOrder: 0,
            datumSurface: 'd2',
            measurementPoint: 'p2',
            measurementLabel: 'l2'
          }
        ]
      }
    });
    expect(reviseRes.statusCode).toBe(200);
    const id2 = reviseRes.json().template.id as string;
    expect(reviseRes.json().template.resourceCd).toBe(resourceCd);
    expect(reviseRes.json().template.version).toBe(2);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/part-measurement/templates?includeInactive=true',
      headers: createAuthHeader(adminToken)
    });
    const templates = listRes.json().templates as Array<{
      id: string;
      resourceCd: string;
      isActive: boolean;
    }>;
    const lineage = templates.filter((t) => t.resourceCd === resourceCd);
    expect(lineage.filter((t) => t.isActive)).toHaveLength(1);
    expect(lineage.find((t) => t.isActive)?.id).toBe(id2);
  });

  it('returns 400 when revising THREE_KEY with candidateFhinmei (ADMIN)', async () => {
    const fhincd = `NOCAND-${Date.now()}`;
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-NOCAND',
        name: 't',
        items: [{ sortOrder: 0, datumSurface: 'a', measurementPoint: 'b', measurementLabel: 'c' }]
      }
    });
    expect(createRes.statusCode).toBe(200);
    const id = createRes.json().template.id as string;

    const reviseRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/templates/${id}/revise`,
      headers: createAuthHeader(adminToken),
      payload: {
        name: 't2',
        candidateFhinmei: 'だめ',
        items: [{ sortOrder: 0, datumSurface: 'a2', measurementPoint: 'b2', measurementLabel: 'c2' }]
      }
    });
    expect(reviseRes.statusCode).toBe(400);
  });

  it('retires active template without reactivating old version (ADMIN)', async () => {
    const fhincd = `RET-${Date.now()}`;
    const v1 = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-RET',
        name: 'ret v1',
        items: [{ sortOrder: 0, datumSurface: 'a', measurementPoint: 'b', measurementLabel: 'c' }]
      }
    });
    expect(v1.statusCode).toBe(200);
    const id1 = v1.json().template.id as string;

    const v2 = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/templates/${id1}/revise`,
      headers: createAuthHeader(adminToken),
      payload: {
        name: 'ret v2',
        items: [{ sortOrder: 0, datumSurface: 'a2', measurementPoint: 'b2', measurementLabel: 'c2' }]
      }
    });
    expect(v2.statusCode).toBe(200);
    const id2 = v2.json().template.id as string;

    const retireRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/templates/${id2}/retire`,
      headers: createAuthHeader(adminToken),
      payload: {}
    });
    expect(retireRes.statusCode).toBe(200);
    expect(retireRes.json().template.isActive).toBe(false);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/part-measurement/templates?includeInactive=true',
      headers: createAuthHeader(adminToken)
    });
    const templates = listRes.json().templates as Array<{ id: string; isActive: boolean }>;
    const t1 = templates.find((t) => t.id === id1);
    const t2 = templates.find((t) => t.id === id2);
    expect(t1?.isActive).toBe(false);
    expect(t2?.isActive).toBe(false);
  });

  it('returns 409 when retiring inactive template (ADMIN)', async () => {
    const fhincd = `RET409-${Date.now()}`;
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-RET409',
        name: 'x',
        items: [{ sortOrder: 0, datumSurface: 'a', measurementPoint: 'b', measurementLabel: 'c' }]
      }
    });
    expect(createRes.statusCode).toBe(200);
    const id1 = createRes.json().template.id as string;

    const reviseRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/templates/${id1}/revise`,
      headers: createAuthHeader(adminToken),
      payload: {
        name: 'x2',
        items: [{ sortOrder: 0, datumSurface: 'a2', measurementPoint: 'b2', measurementLabel: 'c2' }]
      }
    });
    expect(reviseRes.statusCode).toBe(200);
    const id2 = reviseRes.json().template.id as string;

    const retireRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/templates/${id2}/retire`,
      headers: createAuthHeader(adminToken),
      payload: {}
    });
    expect(retireRes.statusCode).toBe(200);

    const again = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/templates/${id2}/retire`,
      headers: createAuthHeader(adminToken),
      payload: {}
    });
    expect(again.statusCode).toBe(409);
  });

  it('returns 409 when revising inactive template (ADMIN)', async () => {
    const fhincd = `REV409-${Date.now()}`;
    const first = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-409',
        name: 'v1',
        items: [
          {
            sortOrder: 0,
            datumSurface: 'a',
            measurementPoint: 'b',
            measurementLabel: 'c'
          }
        ]
      }
    });
    const id1 = first.json().template.id as string;

    await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-409',
        name: 'v2',
        items: [
          {
            sortOrder: 0,
            datumSurface: 'a2',
            measurementPoint: 'b2',
            measurementLabel: 'c2'
          }
        ]
      }
    });

    const reviseRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/templates/${id1}/revise`,
      headers: createAuthHeader(adminToken),
      payload: {
        name: 'nope',
        items: [
          {
            sortOrder: 0,
            datumSurface: 'x',
            measurementPoint: 'y',
            measurementLabel: 'z'
          }
        ]
      }
    });
    expect(reviseRes.statusCode).toBe(409);
  });

  it('returns 401 without auth for GET /api/part-measurement/templates/candidates', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/part-measurement/templates/candidates?fhincd=X&processGroup=cutting&resourceCd=1'
    });
    expect(res.statusCode).toBe(401);
  });

  it('lists template candidates with matchKind and selectable (ADMIN)', async () => {
    const fhincd = `CAND-${Date.now()}`;
    const create = async (resourceCd: string, name: string, processGroup: 'cutting' | 'grinding' = 'cutting') => {
      const r = await app.inject({
        method: 'POST',
        url: '/api/part-measurement/templates',
        headers: createAuthHeader(adminToken),
        payload: {
          fhincd,
          processGroup,
          resourceCd,
          name,
          items: [
            {
              sortOrder: 0,
              datumSurface: 'a',
              measurementPoint: 'b',
              measurementLabel: 'c'
            }
          ]
        }
      });
      expect(r.statusCode).toBe(200);
      return r.json().template.id as string;
    };
    await create('RES-CAND-A', 'テンプレA');
    await create('RES-CAND-B', 'テンプレB');
    await create('RES-CAND-A', '研削側・同一資源', 'grinding');

    await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        templateScope: 'fhinmei_only',
        fhincd: '',
        resourceCd: '',
        processGroup: 'cutting',
        candidateFhinmei: 'シャフト特殊品',
        name: 'FHINMEI 候補',
        items: [
          {
            sortOrder: 0,
            datumSurface: 'a',
            measurementPoint: 'b',
            measurementLabel: 'c'
          }
        ]
      }
    });

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/templates/candidates?fhincd=${encodeURIComponent(fhincd)}&processGroup=cutting&resourceCd=RES-CAND-A&fhinmei=${encodeURIComponent('シャフト特殊品')}`,
      headers: createAuthHeader(adminToken)
    });
    expect(listRes.statusCode).toBe(200);
    const candidates = listRes.json().candidates as Array<{
      matchKind: string;
      selectable: boolean;
      itemCount: number;
      template: { resourceCd: string; fhincd: string; items: unknown[] };
    }>;
    const kinds = candidates.map((c) => c.matchKind);
    expect(kinds).toContain('exact_resource');
    expect(kinds).toContain('two_key_fhincd_resource');
    expect(kinds).toContain('one_key_fhinmei');
    const exact = candidates.find((c) => c.matchKind === 'exact_resource');
    expect(exact?.selectable).toBe(true);
    expect(exact?.template.items).toHaveLength(0);
    expect(exact?.itemCount).toBe(1);
    const refOnly = candidates.filter((c) => c.matchKind === 'one_key_fhinmei');
    expect(refOnly.length).toBeGreaterThan(0);
    expect(refOnly.every((c) => c.selectable === true)).toBe(true);

    const lowerCaseRes = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/templates/candidates?fhincd=${encodeURIComponent(fhincd.toLowerCase())}&processGroup=cutting&resourceCd=RES-CAND-A`,
      headers: createAuthHeader(adminToken)
    });
    expect(lowerCaseRes.statusCode).toBe(200);
    const lowerCaseKinds = (lowerCaseRes.json().candidates as Array<{ matchKind: string }>).map(
      (candidate) => candidate.matchKind
    );
    expect(lowerCaseKinds).toContain('exact_resource');
  });

  it('lists FHINMEI_ONLY candidate when schedule fhinmei contains candidate key (substring)', async () => {
    const fhincd = `SUB-${Date.now()}`;
    await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-SUB',
        name: 'base',
        items: [{ sortOrder: 0, datumSurface: 'a', measurementPoint: 'b', measurementLabel: 'c' }]
      }
    });
    await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        templateScope: 'fhinmei_only',
        fhincd: '',
        resourceCd: '',
        processGroup: 'cutting',
        candidateFhinmei: 'シャフト',
        name: 'FHINMEI 部分一致候補',
        items: [{ sortOrder: 0, datumSurface: 'a', measurementPoint: 'b', measurementLabel: 'c' }]
      }
    });

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/templates/candidates?fhincd=${encodeURIComponent(fhincd)}&processGroup=cutting&resourceCd=RES-SUB&fhinmei=${encodeURIComponent('シャフト特殊品')}`,
      headers: createAuthHeader(adminToken)
    });
    expect(listRes.statusCode).toBe(200);
    const candidates = listRes.json().candidates as Array<{ matchKind: string; template: { name: string } }>;
    const fhinmeiHits = candidates.filter((c) => c.matchKind === 'one_key_fhinmei');
    expect(fhinmeiHits.some((c) => c.template.name === 'FHINMEI 部分一致候補')).toBe(true);
  });

  it('POST sheets rejects resource mismatch without allowAlternateResourceTemplate', async () => {
    const fhincd = `ALT-${Date.now()}`;
    const t1 = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-T1',
        name: 't1',
        items: [
          { sortOrder: 0, datumSurface: 'a', measurementPoint: 'b', measurementLabel: 'c' }
        ]
      }
    });
    const templateId = t1.json().template.id as string;
    const pn = `PN-ALT-${Date.now()}`;
    const bad = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/sheets',
      headers: createAuthHeader(adminToken),
      payload: {
        productNo: pn,
        fseiban: 'FS-ALT',
        fhincd,
        fhinmei: '品',
        resourceCdSnapshot: 'RES-SCHEDULE',
        processGroup: 'cutting',
        templateId
      }
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toMatch(/資源CD/);

    const ok = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/sheets',
      headers: createAuthHeader(adminToken),
      payload: {
        productNo: `PN-ALT2-${Date.now()}`,
        fseiban: 'FS-ALT2',
        fhincd,
        fhinmei: '品',
        resourceCdSnapshot: 'RES-SCHEDULE',
        processGroup: 'cutting',
        templateId,
        allowAlternateResourceTemplate: true
      }
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().sheet.resourceCdSnapshot).toBe('RES-SCHEDULE');
    expect(ok.json().sheet.template?.resourceCd).toBe('RES-T1');
  });

  it('returns 401 without auth for POST /api/part-measurement/templates/clone-for-schedule-key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates/clone-for-schedule-key',
      payload: {
        sourceTemplateId: '00000000-0000-4000-8000-000000000001',
        fhincd: 'X',
        processGroup: 'cutting',
        resourceCd: '1'
      }
    });
    expect(res.statusCode).toBe(401);
  });

  it('includes self-inspection settings in inspection-drawing template summaries', async () => {
    const { body, contentType } = buildMultipartPng('自主検査図面', MIN_PNG);
    const visualRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/visual-templates',
      headers: { ...createAuthHeader(adminToken), 'content-type': contentType },
      payload: body
    });
    expect(visualRes.statusCode).toBe(200);
    const visualTemplateId = visualRes.json().visualTemplate.id as string;

    const fhincd = `SELF-TPL-${Date.now()}`;
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-SELF-TPL',
        name: '自主検査テンプレ',
        visualTemplateId,
        selfInspectionMode: 'sample',
        selfInspectionSampleSize: 3,
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
            upperLimit: 10.2
          }
        ]
      }
    });
    expect(createRes.statusCode).toBe(200);

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/inspection-drawing/templates?fhincd=${encodeURIComponent(fhincd)}`,
      headers: createAuthHeader(viewerToken)
    });
    expect(listRes.statusCode).toBe(200);
    const template = (listRes.json().templates as Array<Record<string, unknown>>).find((row) => row.fhincd === fhincd);
    expect(template).toBeTruthy();
    expect(template?.selfInspectionMode).toBe('fixed_count');
    expect(template?.selfInspectionFixedCount).toBe(3);
    expect(template?.selfInspectionSampleSize).toBe(3);
  });

  it('resolves, saves, and completes a self-inspection session', async () => {
    const { body, contentType } = buildMultipartPng('自主検査図面', MIN_PNG);
    const visualRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/visual-templates',
      headers: { ...createAuthHeader(adminToken), 'content-type': contentType },
      payload: body
    });
    expect(visualRes.statusCode).toBe(200);
    const visualTemplateId = visualRes.json().visualTemplate.id as string;

    const fhincd = `SELF-${Date.now()}`;
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-SELF',
        name: '自主検査テンプレ',
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
            decimalPlaces: 2
          }
        ]
      }
    });
    expect(createRes.statusCode).toBe(200);
    const templateId = createRes.json().template.id as string;
    const templateItemId = createRes.json().template.items[0].id as string;

    const productNo = `PN-SELF-${Date.now()}`;
    const fseiban = `FS-SELF-${Date.now()}`;
    const scheduleRowId = await seedProductionScheduleRow({
      productNo,
      fseiban,
      fhincd,
      resourceCd: 'RES-SELF'
    });

    const missingScheduleRowRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/self-inspection/sessions/resolve-or-create',
      headers: createAuthHeader(adminToken),
      payload: {
        templateId,
        productNo,
        processGroup: 'cutting',
        resourceCd: 'RES-SELF',
        plannedQuantity: 5,
        fseiban,
        fhincd,
        fhinmei: '自主検査品'
      }
    });
    expect(missingScheduleRowRes.statusCode).toBe(400);

    const missingFseibanRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/self-inspection/sessions/resolve-or-create',
      headers: createAuthHeader(adminToken),
      payload: {
        templateId,
        productNo,
        processGroup: 'cutting',
        resourceCd: 'RES-SELF',
        plannedQuantity: 5,
        scheduleRowId,
        fhincd,
        fhinmei: '自主検査品'
      }
    });
    expect(missingFseibanRes.statusCode).toBe(400);

    const resolveRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/self-inspection/sessions/resolve-or-create',
      headers: createAuthHeader(adminToken),
      payload: {
        templateId,
        productNo,
        processGroup: 'cutting',
        resourceCd: 'RES-SELF',
        plannedQuantity: 5,
        scheduleRowId,
        fseiban,
        fhincd,
        fhinmei: '自主検査品'
      }
    });
    expect(resolveRes.statusCode).toBe(200);
    expect(resolveRes.json().session.selfInspectionMode).toBe('fixed_count');
    expect(resolveRes.json().session.expectedEntryCount).toBe(2);
    const sessionId = resolveRes.json().session.id as string;

    await prisma.productionScheduleOrderSupplement.deleteMany({
      where: { csvDashboardRowId: scheduleRowId }
    });
    const decorationsAfterSupplementRemoved = await new SelfInspectionService().buildLeaderboardDecorations(
      [
        {
          id: scheduleRowId,
          rowData: {
            ProductNo: productNo,
            FSEIBAN: fseiban,
            FHINCD: fhincd,
            FSIGENCD: 'RES-SELF',
            FHINMEI: '自主検査品'
          },
          plannedQuantity: null
        }
      ],
      {}
    );
    expect(decorationsAfterSupplementRemoved[0]?.hasSelfInspectionDrawing).toBe(true);
    expect(decorationsAfterSupplementRemoved[0]?.selfInspectionEntryPath).toBe(
      `/kiosk/part-measurement/self-inspection/sessions/${sessionId}`
    );

    const supplementProductNo = productNo.slice(0, 20);
    const supplementResourceCd = 'RES-SELF'.slice(0, 20);
    await prisma.productionScheduleOrderSupplement.upsert({
      where: { csvDashboardRowId: scheduleRowId },
      update: { plannedQuantity: 5 },
      create: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        csvDashboardRowId: scheduleRowId,
        sourceCsvDashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_SOURCE_DASHBOARD_ID,
        productNo: supplementProductNo,
        resourceCd: supplementResourceCd,
        processOrder: '10',
        plannedQuantity: 5
      }
    });

    const createEntryRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${sessionId}/entries`,
      headers: createAuthHeader(adminToken),
      payload: {
        entryIndex: 0,
        values: [{ templateItemId, value: '10.01' }]
      }
    });
    expect(createEntryRes.statusCode).toBe(200);
    const firstEntryId = createEntryRes.json().entry.id as string;
    const auditEmployee = await createTestEmployee();
    const auditedUpdateRes = await app.inject({
      method: 'PATCH',
      url: `/api/part-measurement/self-inspection/sessions/${sessionId}/entries/${firstEntryId}`,
      headers: createAuthHeader(adminToken),
      payload: {
        ifUnmodifiedSince: createEntryRes.json().entry.updatedAt as string,
        employeeTagUid: auditEmployee.nfcTagUid,
        values: [{ templateItemId, value: '10.01' }]
      }
    });
    expect(auditedUpdateRes.statusCode).toBe(200);
    expect(auditedUpdateRes.json().entry.createdByEmployeeId).toBe(auditEmployee.id);

    const detailWithValuesRes = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/self-inspection/sessions/${sessionId}?entryIndex=0`,
      headers: createAuthHeader(viewerToken)
    });
    expect(detailWithValuesRes.statusCode).toBe(200);
    expect(detailWithValuesRes.json().session.focusedEntry?.entryIndex).toBe(0);
    expect(detailWithValuesRes.json().session.focusedEntry?.values).toHaveLength(1);
    expect(detailWithValuesRes.json().session.entries[0]?.values).toEqual([]);

    const reviseTemplateRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/templates/${templateId}/revise`,
      headers: createAuthHeader(adminToken),
      payload: {
        name: '自主検査テンプレ改版',
        visualTemplateId,
        selfInspectionMode: 'sample',
        selfInspectionSampleSize: 2,
        items: [
          {
            sortOrder: 0,
            datumSurface: 'A',
            measurementPoint: 'P1',
            measurementLabel: '寸法1改',
            displayMarker: '1',
            markerXRatio: 0.2,
            markerYRatio: 0.4,
            nominalValue: 10,
            lowerLimit: 9.8,
            upperLimit: 10.2,
            allowNegative: false,
            decimalPlaces: 2
          }
        ]
      }
    });
    expect(reviseTemplateRes.statusCode).toBe(200);
    const revisedTemplateId = reviseTemplateRes.json().template.id as string;

    const resolveAfterReviseRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/self-inspection/sessions/resolve-or-create',
      headers: createAuthHeader(adminToken),
      payload: {
        templateId: revisedTemplateId,
        productNo,
        processGroup: 'cutting',
        resourceCd: 'RES-SELF',
        plannedQuantity: 5,
        scheduleRowId,
        fseiban,
        fhincd,
        fhinmei: '自主検査品'
      }
    });
    expect(resolveAfterReviseRes.statusCode).toBe(200);
    expect(resolveAfterReviseRes.json().session.id).toBe(sessionId);
    expect(resolveAfterReviseRes.json().session.templateId).toBe(templateId);

    const idempotentRetryRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${sessionId}/entries`,
      headers: createAuthHeader(adminToken),
      payload: {
        entryIndex: 0,
        values: [{ templateItemId, value: '10.01' }]
      }
    });
    expect(idempotentRetryRes.statusCode).toBe(200);
    expect(idempotentRetryRes.json().entry.entryIndex).toBe(0);

    const negativeValueRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${sessionId}/entries`,
      headers: createAuthHeader(adminToken),
      payload: {
        entryIndex: 1,
        values: [{ templateItemId, value: '-1' }]
      }
    });
    expect(negativeValueRes.statusCode).toBe(400);

    const outOfToleranceRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${sessionId}/entries`,
      headers: createAuthHeader(adminToken),
      payload: {
        entryIndex: 1,
        values: [{ templateItemId, value: '10.5' }]
      }
    });
    expect(outOfToleranceRes.statusCode).toBe(400);

    const numericPrecisionRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${sessionId}/entries`,
      headers: createAuthHeader(adminToken),
      payload: {
        entryIndex: 1,
        values: [{ templateItemId, value: 10.001 }]
      }
    });
    expect(numericPrecisionRes.statusCode).toBe(400);

    const listRes1 = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/self-inspection/sessions?status=in_progress&productNo=${encodeURIComponent(productNo)}`,
      headers: createAuthHeader(viewerToken)
    });
    expect(listRes1.statusCode).toBe(200);
    expect((listRes1.json().sessions as Array<Record<string, unknown>>).some((row) => row.id === sessionId)).toBe(true);

    const secondEntryRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${sessionId}/entries`,
      headers: createAuthHeader(adminToken),
      payload: {
        entryIndex: 1,
        values: [{ templateItemId, value: '9.99' }]
      }
    });
    expect(secondEntryRes.statusCode).toBe(200);

    const duplicateIndexRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${sessionId}/entries`,
      headers: createAuthHeader(adminToken),
      payload: {
        entryIndex: 0,
        values: [{ templateItemId, value: '10.02' }]
      }
    });
    expect(duplicateIndexRes.statusCode).toBe(409);

    const beforeCompleteRes = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/self-inspection/sessions/${sessionId}`,
      headers: createAuthHeader(viewerToken)
    });
    expect(beforeCompleteRes.statusCode).toBe(200);
    expect(beforeCompleteRes.json().session.status).toBe('in_progress');
    expect(beforeCompleteRes.json().session.completedAt).toBeNull();

    const completeRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${sessionId}/complete`,
      headers: createAuthHeader(adminToken),
      payload: {}
    });
    expect(completeRes.statusCode).toBe(200);
    expect(completeRes.json().session.status).toBe('completed');
    expect(completeRes.json().session.completedAt).toBeTruthy();
    const completedAtAfterFirst = completeRes.json().session.completedAt as string;

    const completeAgainRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${sessionId}/complete`,
      headers: createAuthHeader(adminToken),
      payload: {}
    });
    expect(completeAgainRes.statusCode).toBe(200);
    expect(completeAgainRes.json().session.completedAt).toBe(completedAtAfterFirst);

    const sessionAfterCompleteRes = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/self-inspection/sessions/${sessionId}`,
      headers: createAuthHeader(viewerToken)
    });
    expect(sessionAfterCompleteRes.statusCode).toBe(200);
    expect(sessionAfterCompleteRes.json().session.id).toBe(sessionId);
    expect(sessionAfterCompleteRes.json().session.expectedEntryCount).toBe(2);
    expect(sessionAfterCompleteRes.json().session.plannedQuantity).toBe(5);
    expect(sessionAfterCompleteRes.json().session.completedAt).toBeTruthy();

    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/self-inspection/sessions/${sessionId}`,
      headers: createAuthHeader(viewerToken)
    });
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.json().session.entries).toHaveLength(2);

    const updateAfterCompleteRes = await app.inject({
      method: 'PATCH',
      url: `/api/part-measurement/self-inspection/sessions/${sessionId}/entries/${detailRes.json().session.entries[0].id}`,
      headers: createAuthHeader(adminToken),
      payload: {
        ifUnmodifiedSince: detailRes.json().session.entries[0].updatedAt as string,
        values: [{ templateItemId, value: '10.00' }]
      }
    });
    expect(updateAfterCompleteRes.statusCode).toBe(409);

    const resetWithoutCompletedConfirmRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${sessionId}/reset`,
      headers: createAuthHeader(adminToken),
      payload: {
        confirmDestructiveReset: true,
        confirmCompletedSessionReset: false,
        requestId: 'reset-req-missing-completed-confirm'
      }
    });
    expect(resetWithoutCompletedConfirmRes.statusCode).toBe(400);

    const resetRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${sessionId}/reset`,
      headers: createAuthHeader(adminToken),
      payload: {
        confirmDestructiveReset: true,
        confirmCompletedSessionReset: true,
        requestId: 'reset-req-success',
        reason: 'integration test'
      }
    });
    expect(resetRes.statusCode).toBe(200);
    expect(resetRes.json().deletedSessionId).toBe(sessionId);
    expect(resetRes.json().deletedEntryCount).toBe(2);
    expect(resetRes.json().deletedValueCount).toBe(2);
    expect(resetRes.json().newSession.id).not.toBe(sessionId);
    expect(resetRes.json().newSession.templateId).toBe(revisedTemplateId);
    expect(resetRes.json().newSession.expectedEntryCount).toBe(2);

    const oldSessionRes = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/self-inspection/sessions/${sessionId}`,
      headers: createAuthHeader(viewerToken)
    });
    expect(oldSessionRes.statusCode).toBe(404);

    const auditRows = await prisma.selfInspectionSessionResetAuditLog.findMany({
      where: { sessionId }
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.nextTemplateId).toBe(revisedTemplateId);
    expect(auditRows[0]?.entryCount).toBe(2);
    expect(auditRows[0]?.valueCount).toBe(2);
    expect(auditRows[0]?.completedAtWasSet).toBe(true);
  });

  it('rejects self-inspection resolve when sample size exceeds planned quantity', async () => {
    const { body, contentType } = buildMultipartPng('自主検査図面', MIN_PNG);
    const visualRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/visual-templates',
      headers: { ...createAuthHeader(adminToken), 'content-type': contentType },
      payload: body
    });
    expect(visualRes.statusCode).toBe(200);
    const visualTemplateId = visualRes.json().visualTemplate.id as string;

    const fhincd = `SELF-SAMPLE-${Date.now()}`;
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-SAMPLE',
        name: '抜取過大テンプレ',
        visualTemplateId,
        selfInspectionMode: 'sample',
        selfInspectionSampleSize: 10,
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
            upperLimit: 10.2
          }
        ]
      }
    });
    expect(createRes.statusCode).toBe(200);
    const templateId = createRes.json().template.id as string;

    const productNo = `PN-SAMPLE-${Date.now()}`;
    const fseiban = `FS-SAMPLE-${Date.now()}`;
    const scheduleRowId = await seedProductionScheduleRow({
      productNo,
      fseiban,
      fhincd,
      resourceCd: 'RES-SAMPLE'
    });

    const resolveRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/self-inspection/sessions/resolve-or-create',
      headers: createAuthHeader(adminToken),
      payload: {
        templateId,
        productNo,
        processGroup: 'cutting',
        resourceCd: 'RES-SAMPLE',
        plannedQuantity: 5,
        scheduleRowId,
        fseiban,
        fhincd,
        fhinmei: '自主検査品'
      }
    });
    expect(resolveRes.statusCode).toBe(400);

    const scheduleRowId2 = await seedProductionScheduleRow({
      productNo: `PN-BOARD-${Date.now()}`,
      fseiban: `FS-BOARD-${Date.now()}`,
      fhincd,
      resourceCd: 'RES-SAMPLE'
    });
    const decorations = await new SelfInspectionService().buildLeaderboardDecorations(
      [
        {
          id: scheduleRowId2,
          rowData: {
            ProductNo: `PN-BOARD`,
            FHINCD: fhincd,
            FHINMEI: '自主検査品',
            FSIGENCD: 'RES-SAMPLE',
            FSEIBAN: 'FS-BOARD'
          },
          plannedQuantity: 5
        }
      ],
      {}
    );
    expect(decorations[0]?.hasSelfInspectionDrawing).toBe(false);
    expect(decorations[0]?.selfInspectionEntryPath).toBeNull();
  });

  it('clone-for-schedule-key creates template for target resource so sheets need no allowAlternateResourceTemplate', async () => {
    const fhincd = `CLONE-${Date.now()}`;
    const tOther = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-SOURCE',
        name: 'source',
        items: [{ sortOrder: 0, datumSurface: 'd1', measurementPoint: 'p1', measurementLabel: 'l1' }]
      }
    });
    expect(tOther.statusCode).toBe(200);
    const sourceId = tOther.json().template.id as string;

    const cloneRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates/clone-for-schedule-key',
      headers: createAuthHeader(adminToken),
      payload: {
        sourceTemplateId: sourceId,
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-TARGET'
      }
    });
    expect(cloneRes.statusCode).toBe(200);
    const body = cloneRes.json() as {
      template: { id: string; resourceCd: string; fhincd: string; items: Array<{ measurementLabel: string }> };
      didClone: boolean;
    };
    expect(body.template.resourceCd).toBe('RES-TARGET');
    expect(body.template.fhincd).toBe(fhincd);
    expect(body.template.templateScope).toBe('three_key');
    expect(body.template.items).toHaveLength(1);
    expect(body.template.items[0].measurementLabel).toBe('l1');
    expect(body.didClone).toBe(true);

    const pn = `PN-CLONE-${Date.now()}`;
    const sheetRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/sheets',
      headers: createAuthHeader(adminToken),
      payload: {
        productNo: pn,
        fseiban: 'FS-CLONE',
        fhincd,
        fhinmei: '品',
        resourceCdSnapshot: 'RES-TARGET',
        processGroup: 'cutting',
        templateId: body.template.id
      }
    });
    expect(sheetRes.statusCode).toBe(200);
    expect(sheetRes.json().sheet.resourceCdSnapshot).toBe('RES-TARGET');
    expect(sheetRes.json().sheet.template?.resourceCd).toBe('RES-TARGET');
  });

  it('clone-for-schedule-key reuses existing active template for target key', async () => {
    const fhincd = `CLONE2-${Date.now()}`;
    const existingRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-T',
        name: 'already',
        items: [{ sortOrder: 0, datumSurface: 'a', measurementPoint: 'b', measurementLabel: 'c' }]
      }
    });
    expect(existingRes.statusCode).toBe(200);
    const existingId = existingRes.json().template.id as string;

    const sourceRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-SRC',
        name: 'source',
        items: [{ sortOrder: 0, datumSurface: 'x', measurementPoint: 'y', measurementLabel: 'z' }]
      }
    });
    expect(sourceRes.statusCode).toBe(200);
    const sourceId = sourceRes.json().template.id as string;

    const cloneRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates/clone-for-schedule-key',
      headers: createAuthHeader(adminToken),
      payload: {
        sourceTemplateId: sourceId,
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-T'
      }
    });
    expect(cloneRes.statusCode).toBe(200);
    const body = cloneRes.json() as { template: { id: string }; reusedExistingActive: boolean; didClone: boolean };
    expect(body.template.id).toBe(existingId);
    expect(body.reusedExistingActive).toBe(true);
    expect(body.didClone).toBe(false);
  });

  it('serializes concurrent clone-for-schedule-key so target key keeps a single active template', async () => {
    const fhincd = `CLONE-CONC-${Date.now()}`;
    const targetResourceCd = 'RES-TARGET-CONC';
    const sourceRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-SRC-CONC',
        name: 'clone source',
        items: [{ sortOrder: 0, datumSurface: 'a', measurementPoint: 'b', measurementLabel: 'c' }]
      }
    });
    expect(sourceRes.statusCode).toBe(200);
    const sourceId = sourceRes.json().template.id as string;

    const clonePayload = {
      sourceTemplateId: sourceId,
      fhincd,
      processGroup: 'cutting',
      resourceCd: targetResourceCd
    };

    const [first, second] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/part-measurement/templates/clone-for-schedule-key',
        headers: createAuthHeader(adminToken),
        payload: clonePayload
      }),
      app.inject({
        method: 'POST',
        url: '/api/part-measurement/templates/clone-for-schedule-key',
        headers: createAuthHeader(adminToken),
        payload: clonePayload
      })
    ]);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const bodies = [first.json(), second.json()] as Array<{
      template: { id: string };
      reusedExistingActive: boolean;
      didClone: boolean;
    }>;
    expect(bodies.filter((body) => body.didClone).length).toBe(1);
    expect(bodies.filter((body) => body.reusedExistingActive).length).toBe(1);
    expect(new Set(bodies.map((body) => body.template.id)).size).toBe(1);

    const activeCount = await prisma.partMeasurementTemplate.count({
      where: {
        fhincd,
        processGroup: 'CUTTING',
        resourceCd: targetResourceCd,
        isActive: true,
        templateScope: 'THREE_KEY'
      }
    });
    expect(activeCount).toBe(1);

    const totalCount = await prisma.partMeasurementTemplate.count({
      where: {
        fhincd,
        processGroup: 'CUTTING',
        resourceCd: targetResourceCd,
        templateScope: 'THREE_KEY'
      }
    });
    expect(totalCount).toBe(1);
  });

  it('allows a second sheet in the same session with a different template (allowAlternate) and rejects duplicate template', async () => {
    const fhincd = `MS-${Date.now()}`;
    const scheduleRes = 'RES-SCHEDULE';
    const t1 = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-MS-A',
        name: 'テンプレA',
        items: [{ sortOrder: 0, datumSurface: 'a', measurementPoint: 'b', measurementLabel: 'c' }]
      }
    });
    const t2 = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-MS-B',
        name: 'テンプレB',
        items: [{ sortOrder: 0, datumSurface: 'a', measurementPoint: 'b', measurementLabel: 'd' }]
      }
    });
    expect(t1.statusCode).toBe(200);
    expect(t2.statusCode).toBe(200);
    const id1 = t1.json().template.id as string;
    const id2 = t2.json().template.id as string;

    const pn = `PN-MS-${Date.now()}`;
    const basePayload = {
      productNo: pn,
      fseiban: 'FS-MS',
      fhincd,
      fhinmei: '品',
      resourceCdSnapshot: scheduleRes,
      processGroup: 'cutting' as const,
      allowAlternateResourceTemplate: true
    };

    const first = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/sheets',
      headers: createAuthHeader(adminToken),
      payload: { ...basePayload, templateId: id1 }
    });
    expect(first.statusCode).toBe(200);
    const body1 = first.json() as { sheet: { id: string; sessionId: string }; session: { id: string; sheets: { id: string }[] } };
    expect(body1.session).toBeTruthy();
    expect(body1.session.sheets).toHaveLength(1);
    const sessionId = body1.session.id;

    const second = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/sheets',
      headers: createAuthHeader(adminToken),
      payload: { ...basePayload, templateId: id2, sessionId }
    });
    expect(second.statusCode).toBe(200);
    const body2 = second.json() as { session: { sheets: unknown[] } };
    expect(body2.session.sheets).toHaveLength(2);

    const dup = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/sheets',
      headers: createAuthHeader(adminToken),
      payload: { ...basePayload, templateId: id1, sessionId }
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().errorCode).toBe('PART_MEASUREMENT_TEMPLATE_ALREADY_IN_SESSION');
  });

  it('sets session completedAt when all child sheets are finalized', async () => {
    const emp = await createTestEmployee();
    const fhincd = `MS-DONE-${Date.now()}`;
    const scheduleRes = 'RES-SCHEDULE-DONE';
    const t1 = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-DONE-A',
        name: 'テンプレA',
        items: [{ sortOrder: 0, datumSurface: 'a', measurementPoint: 'b', measurementLabel: 'c' }]
      }
    });
    const t2 = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-DONE-B',
        name: 'テンプレB',
        items: [{ sortOrder: 0, datumSurface: 'a', measurementPoint: 'b', measurementLabel: 'd' }]
      }
    });
    const t3 = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-DONE-C',
        name: 'テンプレC',
        items: [{ sortOrder: 0, datumSurface: 'a', measurementPoint: 'b', measurementLabel: 'e' }]
      }
    });
    expect(t1.statusCode).toBe(200);
    expect(t2.statusCode).toBe(200);
    expect(t3.statusCode).toBe(200);
    const id1 = t1.json().template.id as string;
    const id2 = t2.json().template.id as string;
    const id3 = t3.json().template.id as string;

    const pn = `PN-DONE-${Date.now()}`;
    const basePayload = {
      productNo: pn,
      fseiban: 'FS-DONE',
      fhincd,
      fhinmei: '品',
      resourceCdSnapshot: scheduleRes,
      processGroup: 'cutting' as const,
      allowAlternateResourceTemplate: true
    };

    const first = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/sheets',
      headers: createAuthHeader(adminToken),
      payload: { ...basePayload, templateId: id1 }
    });
    expect(first.statusCode).toBe(200);
    const sessionId = first.json().session.id as string;
    const sheet1Id = first.json().sheet.id as string;

    const second = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/sheets',
      headers: createAuthHeader(adminToken),
      payload: { ...basePayload, templateId: id2, sessionId }
    });
    expect(second.statusCode).toBe(200);
    const sheet2Id = second.json().sheet.id as string;

    const g1 = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/sheets/${sheet1Id}`,
      headers: createAuthHeader(adminToken)
    });
    const g2 = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/sheets/${sheet2Id}`,
      headers: createAuthHeader(adminToken)
    });
    const item1 = g1.json().sheet.template.items[0].id as string;
    const item2 = g2.json().sheet.template.items[0].id as string;

    const tag = emp.nfcTagUid ?? '';
    expect(tag.length).toBeGreaterThan(0);

    for (const [sid, itemId] of [
      [sheet1Id, item1],
      [sheet2Id, item2]
    ] as const) {
      const p = await app.inject({
        method: 'PATCH',
        url: `/api/part-measurement/sheets/${sid}`,
        headers: createAuthHeader(adminToken),
        payload: {
          quantity: 1,
          employeeTagUid: tag,
          results: [{ pieceIndex: 0, templateItemId: itemId, value: '1.0' }]
        }
      });
      expect(p.statusCode).toBe(200);
      const fin = await app.inject({
        method: 'POST',
        url: `/api/part-measurement/sheets/${sid}/finalize`,
        headers: createAuthHeader(adminToken),
        payload: {}
      });
      expect(fin.statusCode).toBe(200);
    }

    const after = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/sheets/${sheet1Id}`,
      headers: createAuthHeader(adminToken)
    });
    expect(after.statusCode).toBe(200);
    const sess = after.json().session as { completedAt: string | null };
    expect(sess.completedAt).toBeTruthy();

    const third = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/sheets',
      headers: createAuthHeader(adminToken),
      payload: { ...basePayload, templateId: id3, sessionId }
    });
    expect(third.statusCode).toBe(200);
    expect(third.json().session.completedAt).toBeNull();
  });

  it('exports CSV with sessionId header', async () => {
    const fhincd = `CSV-${Date.now()}`;
    const t = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-CSV',
        name: 'csv',
        items: [{ sortOrder: 0, datumSurface: 'a', measurementPoint: 'b', measurementLabel: 'c' }]
      }
    });
    const templateId = t.json().template.id as string;
    const sheetRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/sheets',
      headers: createAuthHeader(adminToken),
      payload: {
        productNo: `PN-CSV-${Date.now()}`,
        fseiban: 'FS-CSV',
        fhincd,
        fhinmei: '品',
        resourceCdSnapshot: 'RES-CSV',
        processGroup: 'cutting',
        templateId
      }
    });
    const sheetId = sheetRes.json().sheet.id as string;
    const csvRes = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/sheets/${sheetId}/export.csv`,
      headers: createAuthHeader(adminToken)
    });
    expect(csvRes.statusCode).toBe(200);
    expect(csvRes.payload).toContain('H,sessionId,');
  });
});

describe('part-measurement drawing PDF import', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;
  let pdftoppmAvailable = false;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
    try {
      await execFileAsync('pdftoppm', ['-v']);
      pdftoppmAvailable = true;
    } catch {
      pdftoppmAvailable = false;
    }
  });

  beforeEach(async () => {
    await cleanPartMeasurementTables();
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('creates visual template from PDF (first page only) when pdftoppm is available', async (ctx) => {
    if (!pdftoppmAvailable) {
      ctx.skip();
    }
    const { body, contentType } = buildMultipartPdf('pdf-drawing', MIN_PDF);
    const up = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/visual-templates',
      headers: { ...createAuthHeader(adminToken), 'content-type': contentType },
      payload: body
    });
    expect(up.statusCode).toBe(200);
    const path = up.json().visualTemplate.drawingImageRelativePath as string;
    expect(path).toMatch(/\.jpg$/);

    const img = await app.inject({
      method: 'GET',
      url: path,
      headers: createAuthHeader(adminToken)
    });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toMatch(/image\/jpeg/);
  });

  it('accepts application/octet-stream with .pdf filename', async (ctx) => {
    if (!pdftoppmAvailable) {
      ctx.skip();
    }
    const { body, contentType } = buildMultipartPdf('pdf-octet', MIN_PDF, 'application/octet-stream');
    const up = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/visual-templates',
      headers: { ...createAuthHeader(adminToken), 'content-type': contentType },
      payload: body
    });
    expect(up.statusCode).toBe(200);
    expect(up.json().visualTemplate.drawingImageRelativePath).toMatch(/\.jpg$/);
  });

  it('rejects .pdf extension when content is not a PDF', async () => {
    const { body, contentType } = buildMultipartDrawingFile('fake', MIN_PNG, {
      filename: 'fake.pdf',
      contentType: 'application/pdf'
    });
    const up = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/visual-templates',
      headers: { ...createAuthHeader(adminToken), 'content-type': contentType },
      payload: body
    });
    expect(up.statusCode).toBe(400);
    expect(up.json().message).toContain('PDF');
    const count = await prisma.partMeasurementVisualTemplate.count();
    expect(count).toBe(0);
  });

  it('keeps PNG visual template upload working', async () => {
    const { body, contentType } = buildMultipartPng('png-drawing', MIN_PNG);
    const up = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/visual-templates',
      headers: { ...createAuthHeader(adminToken), 'content-type': contentType },
      payload: body
    });
    expect(up.statusCode).toBe(200);
    expect(up.json().visualTemplate.drawingImageRelativePath).toMatch(/\.png$/);
    expect(up.json().cleanupToken).toEqual(expect.any(String));
  });

  it('does not save drawing when evaluation multipart items are invalid', async () => {
    const importSpy = vi.spyOn(drawingImport, 'importDrawingAndSave');
    const { body, contentType } = buildMultipartEvaluationTemplate({
      referenceFhincd: 'FH-INVALID-ITEMS',
      referenceResourceCd: 'RES-1',
      itemsJson: 'not-a-json-array',
      fileBuffer: MIN_PDF,
      filename: 'drawing.pdf',
      contentType: 'application/pdf'
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/inspection-drawing/evaluation-templates',
      headers: { ...createAuthHeader(adminToken), 'content-type': contentType },
      payload: body
    });
    expect(res.statusCode).toBe(400);
    expect(importSpy).not.toHaveBeenCalled();
    const visualCount = await prisma.partMeasurementVisualTemplate.count();
    expect(visualCount).toBe(0);
    importSpy.mockRestore();
  });
});

describe('part-measurement visual template cleanup DELETE', () => {
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
    await cleanPartMeasurementTables();
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  async function uploadVisualForCleanup(): Promise<{ id: string; cleanupToken: string }> {
    const { body, contentType } = buildMultipartPng('cleanup-visual', MIN_PNG);
    const up = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/visual-templates',
      headers: { ...createAuthHeader(adminToken), 'content-type': contentType },
      payload: body
    });
    expect(up.statusCode).toBe(200);
    const json = up.json() as {
      visualTemplate: { id: string };
      cleanupToken: string;
    };
    return { id: json.visualTemplate.id, cleanupToken: json.cleanupToken };
  }

  it('returns 204 and deletes unused visual template with matching cleanup token', async () => {
    const { id, cleanupToken } = await uploadVisualForCleanup();

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/part-measurement/visual-templates/${id}`,
      headers: {
        ...createAuthHeader(adminToken),
        'x-visual-cleanup-token': cleanupToken
      }
    });
    expect(del.statusCode).toBe(204);

    const row = await prisma.partMeasurementVisualTemplate.findUnique({ where: { id } });
    expect(row).toBeNull();
  });

  it('returns 400 when cleanup token header is missing', async () => {
    const { id } = await uploadVisualForCleanup();

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/part-measurement/visual-templates/${id}`,
      headers: createAuthHeader(adminToken)
    });
    expect(del.statusCode).toBe(400);
    expect(del.json().errorCode).toBe('VISUAL_CLEANUP_TOKEN_REQUIRED');

    const row = await prisma.partMeasurementVisualTemplate.findUnique({ where: { id } });
    expect(row).not.toBeNull();
  });

  it('returns 403 when cleanup token is invalid', async () => {
    const { id } = await uploadVisualForCleanup();

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/part-measurement/visual-templates/${id}`,
      headers: {
        ...createAuthHeader(adminToken),
        'x-visual-cleanup-token': 'not-a-valid-token'
      }
    });
    expect(del.statusCode).toBe(403);
    expect(del.json().errorCode).toBe('VISUAL_CLEANUP_TOKEN_INVALID');
  });

  it('returns 403 when cleanup token targets a different visual template id', async () => {
    const first = await uploadVisualForCleanup();
    const second = await uploadVisualForCleanup();

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/part-measurement/visual-templates/${first.id}`,
      headers: {
        ...createAuthHeader(adminToken),
        'x-visual-cleanup-token': second.cleanupToken
      }
    });
    expect(del.statusCode).toBe(403);

    const firstRow = await prisma.partMeasurementVisualTemplate.findUnique({ where: { id: first.id } });
    const secondRow = await prisma.partMeasurementVisualTemplate.findUnique({ where: { id: second.id } });
    expect(firstRow).not.toBeNull();
    expect(secondRow).not.toBeNull();
  });

  it('returns 409 when visual template is referenced by a business template', async () => {
    const { id, cleanupToken } = await uploadVisualForCleanup();
    const fhincd = `VT-CLEAN-${Date.now()}`;

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-CLEAN',
        name: 'bound visual',
        visualTemplateId: id,
        items: [
          {
            sortOrder: 0,
            datumSurface: 'A',
            measurementPoint: 'B',
            measurementLabel: 'L1'
          }
        ]
      }
    });
    expect(createRes.statusCode).toBe(200);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/part-measurement/visual-templates/${id}`,
      headers: {
        ...createAuthHeader(adminToken),
        'x-visual-cleanup-token': cleanupToken
      }
    });
    expect(del.statusCode).toBe(409);

    const row = await prisma.partMeasurementVisualTemplate.findUnique({ where: { id } });
    expect(row).not.toBeNull();
  });
});
