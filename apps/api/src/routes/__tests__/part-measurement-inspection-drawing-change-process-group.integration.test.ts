import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { createAuthHeader, createTestUser } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

const MIN_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function buildMultipartPng(name: string, fileBuffer: Buffer): { body: Buffer; contentType: string } {
  const boundary = `----testPmPg${Date.now()}`;
  const crlf = '\r\n';
  const parts: Buffer[] = [];
  const push = (s: string) => parts.push(Buffer.from(s, 'utf8'));
  push(`--${boundary}${crlf}`);
  push(`Content-Disposition: form-data; name="name"${crlf}${crlf}${name}${crlf}`);
  push(`--${boundary}${crlf}`);
  push(
    `Content-Disposition: form-data; name="file"; filename="drawing.png"${crlf}Content-Type: image/png${crlf}${crlf}`
  );
  parts.push(fileBuffer);
  push(`${crlf}--${boundary}--${crlf}`);
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

function validInspectionDrawingItems(label = 'L1') {
  return [
    {
      sortOrder: 0,
      datumSurface: 'A',
      measurementPoint: 'B',
      measurementLabel: label,
      displayMarker: '1',
      markerXRatio: 0.25,
      markerYRatio: 0.75,
      nominalValue: 20,
      lowerLimit: 19.98,
      upperLimit: 20.02
    }
  ];
}

async function cleanPartMeasurementTables() {
  await prisma.partMeasurementResult.deleteMany({});
  await prisma.partMeasurementSheet.deleteMany({});
  await prisma.partMeasurementSession.deleteMany({});
  await prisma.partMeasurementTemplate.deleteMany({});
  await prisma.partMeasurementTemplateSiblingGroup.deleteMany({});
  await prisma.partMeasurementVisualTemplate.deleteMany({});
}

describe('inspection drawing template change-process-group API', () => {
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

  async function createVisualTemplateId(): Promise<string> {
    const upload = buildMultipartPng('change-pg', MIN_PNG);
    const up = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/visual-templates',
      headers: { ...createAuthHeader(adminToken), 'content-type': upload.contentType },
      payload: upload.body
    });
    expect(up.statusCode).toBe(200);
    return up.json().visualTemplate.id as string;
  }

  it('changes process group for all versions in the same lineage', async () => {
    const visualTemplateId = await createVisualTemplateId();
    const fhincd = `CPG-${Date.now()}`;
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-CPG',
        name: 'change pg single',
        visualTemplateId,
        items: validInspectionDrawingItems()
      }
    });
    expect(createRes.statusCode).toBe(200);
    const v1 = createRes.json().template;

    const reviseRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/templates/${v1.id}/revise`,
      headers: createAuthHeader(adminToken),
      payload: {
        name: 'change pg single v2',
        visualTemplateId,
        items: validInspectionDrawingItems('L2')
      }
    });
    expect(reviseRes.statusCode).toBe(200);
    const v2 = reviseRes.json().template;

    const changeRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/inspection-drawing/templates/${v2.id}/change-process-group`,
      headers: createAuthHeader(adminToken),
      payload: { processGroup: 'grinding' }
    });
    expect(changeRes.statusCode).toBe(200);
    expect(changeRes.json().template.processGroup).toBe('grinding');

    const rows = await prisma.partMeasurementTemplate.findMany({
      where: { fhincd, resourceCd: 'RES-CPG' },
      orderBy: { version: 'asc' }
    });
    expect(rows.map((row) => `${row.version}:${row.processGroup}`)).toEqual([
      '1:GRINDING',
      '2:GRINDING'
    ]);
  });

  it('returns 409 when target process group already has the same fhincd and resource', async () => {
    const visualTemplateId = await createVisualTemplateId();
    const fhincd = `CPG-CONFLICT-${Date.now()}`;

    const cuttingRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: 'RES-X',
        name: 'cutting row',
        visualTemplateId,
        items: validInspectionDrawingItems()
      }
    });
    expect(cuttingRes.statusCode).toBe(200);

    const grindingRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'grinding',
        resourceCd: 'RES-X',
        name: 'grinding row',
        visualTemplateId,
        items: validInspectionDrawingItems('L2')
      }
    });
    expect(grindingRes.statusCode).toBe(200);
    const grindingTemplate = grindingRes.json().template;

    const changeRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/inspection-drawing/templates/${grindingTemplate.id}/change-process-group`,
      headers: createAuthHeader(adminToken),
      payload: { processGroup: 'cutting' }
    });
    expect(changeRes.statusCode).toBe(409);
    expect(changeRes.json().message).toContain('変更先の工程に同じ品番・資源のテンプレートが既に存在します');
  });

  it('changes process group for all sibling group members and versions', async () => {
    const visualTemplateId = await createVisualTemplateId();
    const fhincd = `CPG-GROUP-${Date.now()}`;
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/inspection-drawing/template-groups',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCds: ['RES-G1', 'RES-G2'],
        name: `group ${fhincd}`,
        visualTemplateId,
        items: validInspectionDrawingItems()
      }
    });
    expect(createRes.statusCode).toBe(200);
    const siblingGroupId = createRes.json().group.id as string;
    const firstTemplateId = createRes.json().templates[0].id as string;

    const reviseRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/inspection-drawing/template-groups/${siblingGroupId}/revise`,
      headers: createAuthHeader(adminToken),
      payload: {
        name: `group ${fhincd} v2`,
        visualTemplateId,
        items: validInspectionDrawingItems('L2')
      }
    });
    expect(reviseRes.statusCode).toBe(200);

    const changeRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/inspection-drawing/templates/${firstTemplateId}/change-process-group`,
      headers: createAuthHeader(adminToken),
      payload: { processGroup: 'grinding' }
    });
    expect(changeRes.statusCode).toBe(200);

    const templates = await prisma.partMeasurementTemplate.findMany({
      where: { fhincd },
      orderBy: [{ resourceCd: 'asc' }, { version: 'asc' }]
    });
    expect(templates.every((row) => row.processGroup === 'GRINDING')).toBe(true);
    expect(templates).toHaveLength(4);

    const group = await prisma.partMeasurementTemplateSiblingGroup.findUniqueOrThrow({
      where: { id: siblingGroupId }
    });
    expect(group.processGroup).toBe('GRINDING');
  });
});
