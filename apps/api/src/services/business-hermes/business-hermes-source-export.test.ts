import { describe, expect, it, vi } from 'vitest';
import { BusinessHermesMcpService } from './business-hermes-mcp.service.js';
import { exportBusinessHermesSources } from './business-hermes-source-export.js';
import { NightlySourceEvidence } from './business-hermes-nightly-source-evidence.js';

function fixture() {
  const rows = Array.from({ length: 425 }, (_, i) => ({
    id: `nc-${i}`, nonconformityNo: String(20260000 + i), partNumber: 'MD001', partName: null,
    machineName: null, originDepartmentCode: null, originDepartmentName: null,
    nonconformityContent: '検査内容', remarks: null, correctiveContent1: null, correctiveContent2: null,
    dispositionContent: '記録済み処置', discoveredOn: null, sourceUpdatedOn: null
  }));
  const findMany = vi.fn(async ({ skip, take }: { skip: number; take: number }) => rows.slice(skip, skip + take));
  const readPublishedGroups = vi.fn().mockResolvedValue([]);
  const service = new BusinessHermesMcpService({
    db: { scawStfutekigoCurrent: { findMany, count: vi.fn().mockResolvedValue(rows.length),
      findFirst: vi.fn().mockResolvedValue(rows[0]) } } as never,
    workInstructions: { readPublishedGroups, readPublishedGroup: vi.fn(), searchPublishedGroups: vi.fn() }
  });
  return { service, findMany, readPublishedGroups, rows };
}

describe('Authorized background source pages', () => {
  it('exports every identity once in bounded larger pages and preserves detail evidence', async () => {
    const { service, findMany, readPublishedGroups, rows } = fixture();
    const evidence = new NightlySourceEvidence();
    const result = await exportBusinessHermesSources(service, undefined, record => evidence.add(record));
    expect(result.records.map(r => r.id)).toEqual(rows.map(r => r.id));
    expect(findMany.mock.calls.map(([args]) => args)).toEqual([0, 200, 400].map(skip => expect.objectContaining({
      skip, take: 200, where: { isPresentInLatestSnapshot: true }
    })));
    expect(readPublishedGroups).toHaveBeenCalledWith(expect.objectContaining({ limit: 201, offset: 0 }));
    const detail = await service.call('business_hermes_get_detail', { kind: 'nonconformity', id: rows[0]!.id });
    expect(await evidence.read({ kind: 'nonconformity', id: rows[0]!.id }, service, new AbortController().signal)).toEqual(detail);
  });

  it('keeps the interactive tool limited to 20 even if the caller requests a larger export', async () => {
    const { service, findMany } = fixture();
    const result = await service.call('business_hermes_search', { kind: 'nonconformity', limit: 200, maximum: 200 });
    expect(JSON.parse(result.content[0]!.text).results).toHaveLength(20);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }));
    expect((await service.call('readSourcePage', { kind: 'nonconformity' })).isError).toBe(true);
  });

  it('rejects unsupported kinds and invalid cursors before reading the database', async () => {
    const { service, findMany } = fixture();
    for (const [kind, offset] of [['both', 0], ['nonconformity', -1], ['nonconformity', 100_000], ['work_instruction', 1.5]] as const) {
      await expect(service.readSourcePage(kind, offset)).rejects.toThrow('cursor');
    }
    expect(findMany).not.toHaveBeenCalled();
  });

  it('stops before reading another page after cancellation', async () => {
    const { service, findMany } = fixture();
    const controller = new AbortController();
    await expect(exportBusinessHermesSources(service, controller.signal, () => controller.abort())).rejects.toThrow();
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
