process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';

import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../production-schedule/constants.js';
import { readPartNamesByPartNumbers, readPartNumbersByPartName } from '../../work-instructions/repositories/prisma-work-instruction-part-names.js';
import { PrismaWorkInstructionRepository } from '../../work-instructions/repositories/prisma-work-instruction.repository.js';
import { WorkInstructionReadService } from '../../work-instructions/work-instruction-read.service.js';
import { ProcedureMaterialService } from '../procedure-material.service.js';
import { ProcedureMaterialWorkInstructionService } from '../procedure-material-work-instruction.service.js';

const prefix = `PMSRCH-${process.pid}-${Date.now()}`;
const modified = new Date('2099-01-01T00:00:00Z');
const repository = new PrismaWorkInstructionRepository({ db: prisma });
// Candidate listing reads only database projections, never image bytes.
const read = new WorkInstructionReadService(repository, { read: vi.fn() } as never);
const shelf = new ProcedureMaterialService(prisma, {} as never);
const photos = new ProcedureMaterialWorkInstructionService(prisma, {} as never, () => read);

function fullWidth(text: string) {
  return [...text].map((char) => /[!-~]/.test(char) ? String.fromCharCode(char.charCodeAt(0) + 0xfee0) : char).join('');
}

async function cleanupFixtures() {
  await prisma.procedureMaterial.deleteMany({ where: { gmailDedupeKey: { startsWith: prefix } } });
  await prisma.csvDashboardRow.deleteMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, dataHash: { startsWith: prefix } } });
  const rowWhere = { sourceSystem: prefix };
  await prisma.workInstructionSourcePublication.deleteMany({ where: { row: rowWhere } });
  await prisma.workInstructionEditRevision.deleteMany({ where: { sourceVersion: { row: rowWhere } } });
  await prisma.workInstructionSourceVersion.deleteMany({ where: { row: rowWhere } });
  await prisma.workInstructionRow.deleteMany({ where: rowWhere });
  await prisma.workInstructionAsset.deleteMany({ where: { storageKey: { startsWith: `${prefix}/` } } });
}

async function schedule(partNumber: string, partName: string) {
  return prisma.csvDashboardRow.create({ data: {
    csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, occurredAt: new Date(),
    dataHash: `${prefix}-${randomUUID()}`, rowData: { FHINCD: partNumber, FHINMEI: partName },
  } });
}

async function material(suffix: string, data: Partial<Prisma.ProcedureMaterialCreateInput> = {}) {
  return prisma.procedureMaterial.create({ data: {
    kind: 'PHOTO', gmailDedupeKey: `${prefix}-${suffix}`, receivedAt: modified, ...data,
  } });
}

async function fixtureMaterials(q?: string, state: 'unplaced' | 'placed' = 'unplaced') {
  return (await shelf.list({ state, q, limit: 500 })).filter((item) => item.gmailDedupeKey.startsWith(prefix));
}

async function publicPhotoGroup(partNumber: string, memos: string[]) {
  const row = await prisma.workInstructionRow.create({ data: {
    sourceSystem: prefix, sourceList: 'photos', sourceItemId: BigInt(Date.now()),
    sourceModified: modified, partNumber, shootingTarget: '外径', rawManifest: {}, contentHash: 'a'.repeat(64),
  } });
  const assets = await Promise.all(memos.map((_, index) => prisma.workInstructionAsset.create({ data: {
    storageKey: `${prefix}/${row.id}/${index}`, mimeType: 'image/png', sizeBytes: 4, sha256: 'b'.repeat(64), status: 'ACTIVE',
  } })));
  const version = await prisma.workInstructionSourceVersion.create({ data: {
    rowId: row.id, sourceModified: modified, partNumber, shootingTarget: '外径', rawManifest: {}, contentHash: 'a'.repeat(64),
    steps: { create: memos.map((text, index) => ({ step: BigInt(index + 1), text, imageName: `${index}.png`, imageAssetId: assets[index].id })) },
  } });
  await prisma.workInstructionSourcePublication.create({ data: { rowId: row.id, latestVersionId: version.id, publishedVersionId: version.id } });
  return { row, version, assets };
}

describe('procedure material search (real PostgreSQL)', () => {
  beforeAll(async () => {
    await prisma.csvDashboard.upsert({ where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      create: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID, name: 'Test Production Schedule', columnDefinitions: [], templateConfig: {} }, update: {} });
    await cleanupFixtures();
  });
  beforeEach(cleanupFixtures);
  afterAll(async () => { vi.restoreAllMocks(); await cleanupFixtures(); });

  it('matches partial names across width and case, including full-width stored part numbers and snapshots', async () => {
    const part = `${prefix}-WIDTH`;
    await schedule('\u3000' + fullWidth(part.toLowerCase()) + '\u3000', `${prefix} 軸受ＨｏｌＤｅｒ`);
    const snapshot = await material('snapshot', { origin: 'WORK_INSTRUCTION', workInstructionRef: { partNumber: fullWidth(part.toLowerCase()) } });
    for (const q of ['holder', 'ＨＯＬＤＥＲ', 'ｈｏｌ']) {
      expect(await fixtureMaterials(q)).toEqual([expect.objectContaining({ id: snapshot.id, partName: `${prefix} 軸受ＨｏｌＤｅｒ` })]);
    }
    expect((await readPartNamesByPartNumbers(prisma, [part])).get(part)).toBe(`${prefix} 軸受ＨｏｌＤｅｒ`);
  });

  it('treats percent, underscore and backslash in name queries literally', async () => {
    const literal = `${prefix}-literal`;
    await schedule(`${prefix}-ESCAPE`, `${prefix} %_\\ suffix`);
    await schedule(`${prefix}-DECOY`, `${prefix} XY suffix`);
    const hit = await material(literal, { subjectHint: `${prefix}-ESCAPE` });
    await material('decoy', { subjectHint: `${prefix}-DECOY` });
    for (const q of [`${prefix} %`, `${prefix} %_`, `${prefix} %_\\`]) {
      expect((await fixtureMaterials(q)).map((item) => item.id)).toEqual([hit.id]);
    }
  });

  it('joins more than 200 matching parts without a part-number cutoff for materials and public photo groups', async () => {
    const name = `${prefix} ボルト`;
    await prisma.csvDashboardRow.createMany({ data: Array.from({ length: 221 }, (_, index) => ({
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, occurredAt: new Date(), dataHash: `${prefix}-many-${index}`,
      rowData: { FHINCD: `${prefix}-P${String(index).padStart(3, '0')}`, FHINMEI: name },
    })) });
    const part = `${prefix}-P220`;
    const hit = await material('last-part', { subjectHint: part });
    await publicPhotoGroup(part, ['無関係なメモ']);
    for (const state of ['unplaced', 'placed'] as const) {
      await prisma.procedureMaterial.update({ where: { id: hit.id }, data: { placedAt: state === 'placed' ? modified : null } });
      const lookup = vi.spyOn(prisma, '$queryRaw');
      try {
        expect((await fixtureMaterials(name, state)).map((item) => item.id)).toEqual([hit.id]);
        expect(lookup.mock.calls.filter(([sql]) => (sql as Prisma.Sql).sql.includes('WITH matching_parts'))).toHaveLength(1);
      } finally { lookup.mockRestore(); }
    }
    const lookup = vi.spyOn(prisma, '$queryRaw');
    try {
      expect((await photos.list({ q: name, limit: 1 })).items[0]).toMatchObject({ partNumber: part, partName: name, step: 1 });
      expect(lookup.mock.calls.filter(([sql]) => (sql as Prisma.Sql).sql.includes('WITH matching_parts'))).toHaveLength(1);
    } finally { lookup.mockRestore(); }
  });

  it('uses word boundaries in hints and filenames, returning names only for matching mail materials', async () => {
    const part = `${prefix}-DFD1`;
    const name = `${prefix} 軸受`;
    await schedule(part, name);
    const hint = await material('hint', { subjectHint: `資料(${fullWidth(part.toLowerCase())})`, gmailMessageId: `${prefix}-mail` });
    const filename = await material('filename', { originalFileName: `写真_${fullWidth(part.toLowerCase())}.png` });
    const repeated = await material('repeated', { subjectHint: `${part}0 ${part}` });
    const directOnly = await material('direct-only', { subjectHint: name });
    await material('longer', { subjectHint: `${part}0`, originalFileName: `${part}0.png` });
    await material('prefix-letter', { subjectHint: `A${part}` });
    const items = await fixtureMaterials(name);
    expect(new Set(items.map((item) => item.id))).toEqual(new Set([hint.id, filename.id, repeated.id, directOnly.id]));
    for (const id of [hint.id, filename.id, repeated.id]) expect(items.find((item) => item.id === id)?.partName).toBe(name);
    expect(items.find((item) => item.id === directOnly.id)?.partName).toBeNull();
    expect((await fixtureMaterials()).find((item) => item.id === hint.id)?.partName).toBeNull();
  });

  it('escapes regex punctuation in stored parts and selects the smallest of multiple matched parts', async () => {
    const a = `${prefix}-A.[1]+`;
    const b = `${prefix}-B`;
    await schedule(a, `${prefix} 共通品名 A`);
    await schedule(b, `${prefix} 共通品名 B`);
    const hit = await material('multiple', { subjectHint: `(${b}) (${a})` });
    await material('regex-decoy', { subjectHint: `${prefix}-AX11` });
    expect(await fixtureMaterials(`${prefix} 共通品名`)).toEqual([expect.objectContaining({ id: hit.id, partName: `${prefix} 共通品名 A` })]);
  });

  it('does not reverse lookup one character after NFKC and trim', async () => {
    await schedule(`${prefix}-SHORT`, 'Ａ品名');
    await material('short', { subjectHint: `${prefix}-SHORT` });
    const lookup = vi.spyOn(prisma, '$queryRaw');
    try {
      expect(await readPartNumbersByPartName(prisma, '　Ａ　')).toEqual([]);
      expect(await read.readPublishedGroupsByPartName('　Ａ　')).toEqual([]);
      expect(await fixtureMaterials('　Ａ　')).toEqual([]);
      expect(lookup).not.toHaveBeenCalled();
    } finally { lookup.mockRestore(); }
  });

  it('returns only step 2 for normalized memo-only matching before limit=1, retaining all photos for key/name matches', async () => {
    const part = `${prefix}-PHOTO`;
    const group = await publicPhotoGroup(part, ['手順1のメモ', `${prefix} ＭｅｍＯ 手順2`]);
    expect((await photos.list({ q: `${prefix} memo`, limit: 1 })).items).toEqual([
      expect.objectContaining({ partNumber: part, step: 2, assetId: group.assets[1].id }),
    ]);
    expect((await photos.list({ q: part, limit: 1 })).items[0].step).toBe(1);
    await schedule(part, `${prefix} memo 品名`);
    expect((await photos.list({ q: `${prefix} memo`, limit: 1 })).items[0].step).toBe(1);
  });

  it('never matches pending source groups or draft memos through the part-name join or memo search', async () => {
    const publicPart = `${prefix}-PUBLIC`;
    const hiddenPart = `${prefix}-HIDDEN`;
    const { row, version } = await publicPhotoGroup(publicPart, ['公開メモ']);
    const pending = await prisma.workInstructionSourceVersion.create({ data: {
      rowId: row.id, partNumber: hiddenPart, shootingTarget: '外径', sourceModified: modified,
      rawManifest: {}, contentHash: 'c'.repeat(64), steps: { create: { step: 1n, text: `${prefix} hidden memo` } },
    } });
    await prisma.workInstructionSourcePublication.update({ where: { rowId: row.id }, data: { latestVersionId: pending.id } });
    await prisma.workInstructionRow.update({ where: { id: row.id }, data: { partNumber: hiddenPart } });
    await prisma.workInstructionEditRevision.create({ data: {
      sourceVersionId: version.id, status: 'DRAFT', baseContentHash: version.contentHash,
      memoOverrides: { create: { sourceStep: 1n, migratedFromStep: 1n, baseStepFingerprint: 'fixture', text: `${prefix} draft memo`, migrationState: 'MIGRATED' } },
    } });
    await schedule(hiddenPart, `${prefix} 非公開品名`);
    for (const q of [`${prefix} 非公開品名`, `${prefix} hidden memo`, `${prefix} draft memo`]) {
      expect((await photos.list({ q })).items).toEqual([]);
    }
  });
});
