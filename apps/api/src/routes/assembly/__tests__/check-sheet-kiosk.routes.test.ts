import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { ApiError } from '../../../lib/errors.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { AssemblyCheckSheetService, revisionInclude } from '../../../services/assembly/check-sheet/check-sheet.service.js';
import { makeCheckSheetWorkbook } from '../../../services/assembly/check-sheet/__tests__/check-sheet.fixture.js';
import { normalizeCheckSheet } from '../../../services/assembly/check-sheet/check-sheet-normalizer.js';
import { parseCheckSheetXlsx } from '../../../services/assembly/check-sheet/check-sheet-xlsx-parser.js';
import { registerAssemblyCheckSheetRoutes } from '../check-sheets.js';

const mocks = vi.hoisted(() => ({
  db: {
    $transaction: vi.fn(), $queryRaw: vi.fn(),
    assemblyWorkUnit: { findUnique: vi.fn() },
    assemblyCheckSheet: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    assemblyCheckSheetRevision: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findFirstOrThrow: vi.fn(), findUniqueOrThrow: vi.fn() },
    assemblyCheckSheetGroup: { createMany: vi.fn() }, assemblyCheckSheetItem: { createMany: vi.fn() },
    assemblyCheckSheetAsset: { findUnique: vi.fn() },
    assemblyCheckSheetStamp: { upsert: vi.fn() }, assemblyCheckSheetStampHistory: { create: vi.fn() },
    employee: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn() }, knowledgePositionRank: { findUnique: vi.fn() }
  }, store: { read: vi.fn() }
}));
vi.mock('../shared.js', () => ({ tryGetClientDevice: async () => ({ id: 'synthetic-device', name: '組立1-01' }) }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: mocks.db }));
vi.mock('../../../config/env.js', () => ({ env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' } }));
vi.mock('../../../services/file-storage/file-storage-runtime.js', () => ({ getFileStorageRuntime: () => ({ store: mocks.store }) }));

type Revision = Prisma.AssemblyCheckSheetRevisionGetPayload<{ include: typeof revisionInclude }>;
type Sheet = Prisma.AssemblyCheckSheetGetPayload<{ include: { stamps: true; revision: { include: typeof revisionInclude }; workUnit: true } }>;
const unitId = randomUUID();
const employeeId = randomUUID();
const keyHeaders = { 'x-client-key': 'synthetic-kiosk' };
let app: ReturnType<typeof Fastify>;
let sheet: Sheet | null;
let revisions: Revision[];
let revisionService: AssemblyCheckSheetService;
let source: Buffer;
const request = (suffix: string, payload = {}) => app.inject({ method: 'POST', url: `/api/assembly/check-sheets${suffix}`, headers: keyHeaders, payload });
const stamp = (index: number, extra: Record<string, unknown> = {}) => request(`/${sheet!.id}/stamps`, {
  itemId: sheet!.revision.items[index].id, nfcTagUid: 'worker', result: 'OK', values: {}, flagged: false, ...extra
});

beforeEach(async () => {
  vi.resetAllMocks(); sheet = null;
  source = await makeCheckSheetWorkbook();
  const proposal = normalizeCheckSheet(await parseCheckSheetXlsx(source));
  const revisionId = randomUUID();
  revisions = [{ ...proposal, id: revisionId, revisionRootId: revisionId, revisionNumber: 1, isRevisionHead: true,
    sourceAssetId: randomUUID(), createdByUserId: randomUUID(), createdAt: new Date(), layoutSnapshot: null,
    groups: proposal.groups.map((group) => ({ ...group, id: randomUUID(), revisionId })),
    items: []
  }];
  revisions[0].items = proposal.items.slice(0, 4).map((item, index) => ({
    ...item, id: randomUUID(), revisionId, groupId: revisions[0].groups[0].id,
    itemKey: `1-${index + 1}`, inputKind: 'OK_NG', inputSpec: {}, roleKeys: [], conditionKey: null, conditionLabel: null
  }));
  const db = mocks.db;
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
  db.$queryRaw.mockResolvedValue([{ id: unitId }]);
  db.assemblyWorkUnit.findUnique.mockResolvedValue({ id: unitId, workId: '0418-01', invalidatedAt: null,
    lotSerial: { lot: { productNo: 'BA2610-0418', targetUnit: 'XYZ 3軸ユニット', template: { modelCode: proposal.modelCode } } } });
  db.assemblyCheckSheetRevision.findMany.mockImplementation(async () => revisions.filter((revision) => revision.isRevisionHead));
  db.assemblyCheckSheet.findUnique.mockImplementation(async () => sheet);
  db.assemblyCheckSheet.create.mockImplementation(async ({ data }: { data: Partial<Sheet> }) => {
    sheet = { id: randomUUID(), status: 'IN_PROGRESS', stamps: [], startedAt: new Date(), completedAt: null,
      pausedReason: null, workUnit: { id: unitId, invalidatedAt: null }, ...data,
      revision: revisions.find((revision) => revision.id === data.revisionId) } as Sheet;
    return sheet;
  });
  db.assemblyCheckSheet.update.mockImplementation(async ({ data }: { data: Partial<Sheet> }) => { Object.assign(sheet!, data); return sheet; });
  db.assemblyCheckSheetStamp.upsert.mockImplementation(async ({ create, update }: { create: Sheet['stamps'][number]; update: Partial<Sheet['stamps'][number]> }) => {
    const old = sheet!.stamps.find((entry) => entry.itemId === create.itemId);
    if (old) Object.assign(old, update); else sheet!.stamps.push({ ...create, id: randomUUID() });
  });
  db.employee.findFirst.mockImplementation(async ({ where }: { where: { nfcTagUid: string } }) => where.nfcTagUid === 'unknown' ? null : {
    id: employeeId, employeeCode: 'E001', displayName: '山田 一郎', nfcTagUid: where.nfcTagUid, status: where.nfcTagUid === 'inactive' ? 'INACTIVE' : 'ACTIVE'
  });
  db.employee.findUniqueOrThrow.mockResolvedValue({ positionName: '係長職' });
  db.knowledgePositionRank.findUnique.mockResolvedValue({ rank: 'section_chief' });
  db.assemblyCheckSheetAsset.findUnique.mockResolvedValue({ id: revisions[0].sourceAssetId, storageKey: 'synthetic.xlsx' });
  mocks.store.read.mockResolvedValue(source);
  db.assemblyCheckSheetRevision.findFirstOrThrow.mockImplementation(async () => revisions.at(-1));
  db.assemblyCheckSheetRevision.updateMany.mockImplementation(async () => { revisions.forEach((revision) => { revision.isRevisionHead = false; }); });
  db.assemblyCheckSheetRevision.create.mockImplementation(async ({ data }: { data: Revision }) => { revisions.push({ ...data, isRevisionHead: true, createdAt: new Date(), layoutSnapshot: null, groups: [], items: [] }); });
  db.assemblyCheckSheetGroup.createMany.mockImplementation(async ({ data }: { data: Revision['groups'] }) => { revisions.at(-1)!.groups = data; });
  db.assemblyCheckSheetItem.createMany.mockImplementation(async ({ data }: { data: Revision['items'] }) => { revisions.at(-1)!.items = data.map((item) => ({ ...item, id: randomUUID() })); });
  db.assemblyCheckSheetRevision.findUniqueOrThrow.mockImplementation(async () => revisions.at(-1));
  revisionService = new AssemblyCheckSheetService();
  app = Fastify(); registerErrorHandler(app);
  const auth = async (req: { headers: Record<string, unknown> }) => { if (req.headers['x-client-key'] !== 'synthetic-kiosk') throw new ApiError(401, '端末認証が必要です'); };
  await app.register(async (api) => registerAssemblyCheckSheetRoutes(api, { allowView: auth, allowWriteKiosk: auth }, revisionService), { prefix: '/api' });
  expect((await request('', { workUnitId: unitId })).statusCode).toBe(200);
});
afterEach(async () => { await app.close(); });

describe('check-sheet kiosk route contracts with real service', () => {
  it('selects the matching model head and requires a choice when ambiguous', async () => {
    sheet = null;
    revisions.push({ ...revisions[0], id: randomUUID(), revisionRootId: randomUUID(), modelCode: 'OTHER' });
    expect((await request('', { workUnitId: unitId })).json().revisionId).toBe(revisions[0].id);
    sheet = null;
    revisions[1].modelCode = revisions[0].modelCode;
    expect((await request('', { workUnitId: unitId })).json().errorCode).toBe('CHECK_SHEET_REVISION_REQUIRED');
    mocks.db.assemblyCheckSheetRevision.findMany.mockResolvedValueOnce([revisions[1]]);
    expect((await request('', { workUnitId: unitId, revisionRootId: revisions[1].revisionRootId })).json().revisionId).toBe(revisions[1].id);
  });
  it('does not mutate an invalidated work unit', async () => {
    sheet!.workUnit.invalidatedAt = new Date();
    expect((await stamp(0)).statusCode).toBe(409);
    expect((await request(`/${sheet!.id}/pause`)).statusCode).toBe(409);
  });
  it('requires kiosk authentication for reads and writes', async () => {
    expect((await app.inject({ method: 'GET', url: `/api/assembly/check-sheets/${sheet!.id}` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: `/api/assembly/check-sheets/${sheet!.id}/pause` })).statusCode).toBe(401);
  });
  it('stamps with server identity and preserves the previous stamp on re-stamp', async () => {
    expect((await stamp(0, { result: 'NG', flagged: true, ngReason: '漏れ' })).statusCode).toBe(200);
    expect((await stamp(0)).json().stamps[0]).toMatchObject({ result: 'OK', flagged: false, employeeNameSnapshot: '山田 一郎', ngReason: null });
    expect(mocks.db.assemblyCheckSheetStampHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({ result: 'NG', flagged: true, ngReason: '漏れ', stampId: expect.any(String) }) });
    expect(mocks.db.$queryRaw).toHaveBeenCalled();
  });
  it('allows rank at or above required and rejects insufficient rank with role names', async () => {
    sheet!.revision.items[0].roleKeys = ['leader'];
    expect((await stamp(0)).statusCode).toBe(200);
    sheet!.revision.items[0].roleKeys = ['manager'];
    const response = await stamp(0);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ errorCode: 'CHECK_SHEET_ROLE_REQUIRED', details: { requiredRoles: ['課長'] } });
  });
  it('uses revision department membership, not position rank', async () => {
    sheet!.revision.items[0].roleKeys = ['制御設計担当'];
    expect((await stamp(0)).statusCode).toBe(403);
    sheet!.revision.departmentRoleMembers = { 制御設計担当: [employeeId] };
    expect((await stamp(0)).statusCode).toBe(200);
  });
  it('rejects missing position for rank and unknown/inactive tags', async () => {
    mocks.db.employee.findUniqueOrThrow.mockResolvedValue({ positionName: null });
    sheet!.revision.items[0].roleKeys = ['leader'];
    expect((await stamp(0)).statusCode).toBe(403);
    expect((await stamp(1, { nfcTagUid: 'unknown' })).statusCode).toBe(404);
    expect((await stamp(1, { nfcTagUid: 'inactive' })).statusCode).toBe(403);
    expect((await stamp(1)).statusCode).toBe(200);
  });
  it('checks all condition roles before writing and stamps every matching item NA', async () => {
    sheet!.revision.items.slice(0, 2).forEach((item) => { item.conditionKey = 'motor'; item.conditionLabel = 'モータブラケットが一体でない場合'; });
    sheet!.revision.items[1].roleKeys = ['manager'];
    expect((await request(`/${sheet!.id}/conditions`, { conditionKey: 'motor', applies: false, nfcTagUid: 'worker' })).statusCode).toBe(403);
    expect(mocks.db.assemblyCheckSheetStamp.upsert).not.toHaveBeenCalled();
    sheet!.revision.items[1].roleKeys = [];
    const response = await request(`/${sheet!.id}/conditions`, { conditionKey: 'motor', applies: false, nfcTagUid: 'worker' });
    expect(response.statusCode).toBe(200);
    expect(response.json().stamps.map((entry: { result: string }) => entry.result)).toEqual(['NA', 'NA']);
  });
  it('blocks incomplete/flagged completion, then completes and rejects all mutations', async () => {
    expect((await request(`/${sheet!.id}/complete`)).statusCode).toBe(409);
    for (let index = 0; index < 4; index++) await stamp(index);
    await stamp(0, { result: 'NG', flagged: true, ngReason: '再確認' });
    expect((await request(`/${sheet!.id}/complete`)).statusCode).toBe(409);
    await stamp(0);
    expect((await request(`/${sheet!.id}/complete`)).json().status).toBe('COMPLETED');
    expect((await stamp(0)).statusCode).toBe(409);
    expect((await request(`/${sheet!.id}/resume`)).statusCode).toBe(409);
  });
  it('pauses on unflagged NG and requires explicit resume', async () => {
    expect((await stamp(0, { result: 'NG', ngReason: '異音' })).json().status).toBe('PAUSED');
    expect((await stamp(1)).json().errorCode).toBe('CHECK_SHEET_PAUSED');
    expect((await request(`/${sheet!.id}/complete`)).statusCode).toBe(409);
    expect((await request(`/${sheet!.id}/resume`)).json().status).toBe('IN_PROGRESS');
    expect((await stamp(0)).statusCode).toBe(200);
  });
  it.each([
    ['NUMBER', { fields: [{ key: 'voltage', label: '電圧' }] }, { voltage: '12' }, { voltage: 12 }],
    ['TEXT', { fields: [{ key: 'model', label: '型式' }] }, { model: ' ' }, { model: 'M5' }],
    ['CHOICE', { options: ['有', '無'] }, { result: '別' }, { result: '有' }]
  ] as const)('validates %s values and rejects extra or missing keys', async (kind, spec, invalid, valid) => {
    Object.assign(sheet!.revision.items[0], { inputKind: kind, inputSpec: spec });
    expect((await stamp(0, { values: invalid })).statusCode).toBe(400);
    expect((await stamp(0, { values: {} })).statusCode).toBe(400);
    expect((await stamp(0, { values: { ...valid, extra: 'x' } })).statusCode).toBe(400);
    expect((await stamp(0, { values: valid })).statusCode).toBe(200);
  });
  it('rejects invalid flags and foreign revision items', async () => {
    expect((await stamp(0, { flagged: true })).statusCode).toBe(400);
    expect((await stamp(0, { flagged: true, result: 'NG' })).statusCode).toBe(400);
    expect((await stamp(0, { itemId: randomUUID() })).statusCode).toBe(400);
  });
  it('pins existing sheet to old items after a real revision save', async () => {
    const oldId = sheet!.revisionId;
    const oldItems = sheet!.revision.items.map((item) => item.id);
    const proposal = normalizeCheckSheet(await parseCheckSheetXlsx(source));
    proposal.items[0].label = '新しい版だけの項目';
    const saved = await revisionService.saveRevision({ importId: revisions[0].sourceAssetId, revisionRootId: oldId, proposal }, randomUUID());
    expect(saved.revisionNumber).toBe(2);
    const opened = await request('', { workUnitId: unitId, revisionRootId: saved.revisionRootId });
    expect(opened.json().revisionId).toBe(oldId);
    const fetched = await app.inject({ method: 'GET', url: `/api/assembly/check-sheets/${sheet!.id}`, headers: keyHeaders });
    expect(fetched.json().revision.items.map((item: { id: string }) => item.id)).toEqual(oldItems);
  });
});
