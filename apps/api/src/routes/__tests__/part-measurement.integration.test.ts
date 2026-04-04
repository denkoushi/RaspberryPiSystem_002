import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { createAuthHeader, createTestClientDevice, createTestUser } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

async function cleanPartMeasurementTables() {
  await prisma.partMeasurementResult.deleteMany({});
  await prisma.partMeasurementSheet.deleteMany({});
  await prisma.partMeasurementTemplate.deleteMany({});
  await prisma.partMeasurementVisualTemplate.deleteMany({});
}

/** 1x1 PNG */
const MIN_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function buildMultipartPng(name: string, png: Buffer): { body: Buffer; contentType: string } {
  const boundary = `----testPmVt${Date.now()}`;
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
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

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
            displayMarker: '5'
          }
        ]
      }
    });
    expect(createRes.statusCode).toBe(200);
    const tpl = createRes.json().template;
    expect(tpl.visualTemplateId).toBe(vid);
    expect(tpl.visualTemplate?.id).toBe(vid);
    expect(tpl.items[0].displayMarker).toBe('5');
  });

  it('returns 401 without auth for POST /api/part-measurement/templates', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      payload: { fhincd: 'X', processGroup: 'cutting', resourceCd: 'RC1', name: 'n', items: [] }
    });
    expect(response.statusCode).toBe(401);
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

  it('returns 401 without auth for GET /api/part-measurement/templates/candidates', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/part-measurement/templates/candidates?fhincd=X&processGroup=cutting&resourceCd=1'
    });
    expect(res.statusCode).toBe(401);
  });

  it('lists template candidates with matchKind and selectable (ADMIN)', async () => {
    const fhincd = `CAND-${Date.now()}`;
    const create = async (resourceCd: string, name: string) => {
      const r = await app.inject({
        method: 'POST',
        url: '/api/part-measurement/templates',
        headers: createAuthHeader(adminToken),
        payload: {
          fhincd,
          processGroup: 'cutting',
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

    const otherFhinc = `OTHER-${Date.now()}`;
    await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd: otherFhinc,
        processGroup: 'cutting',
        resourceCd: 'RES-OTHER',
        name: 'シャフト特殊品 参考',
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
      url: `/api/part-measurement/templates/candidates?fhincd=${encodeURIComponent(fhincd)}&processGroup=cutting&resourceCd=RES-CAND-A&fhinmei=${encodeURIComponent('シャフト特殊')}`,
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
    expect(kinds).toContain('same_fhincd_other_resource');
    expect(kinds).toContain('fhinmei_similar');
    const exact = candidates.find((c) => c.matchKind === 'exact_resource');
    expect(exact?.selectable).toBe(true);
    expect(exact?.template.items).toHaveLength(0);
    expect(exact?.itemCount).toBe(1);
    const refOnly = candidates.filter((c) => c.matchKind === 'fhinmei_similar');
    expect(refOnly.every((c) => c.selectable === false)).toBe(true);

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
});
