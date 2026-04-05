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
});
