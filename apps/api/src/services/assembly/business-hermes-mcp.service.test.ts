import { describe, expect, it, vi } from 'vitest';

import { BusinessHermesMcpService } from './business-hermes-mcp.service.js';

describe('BusinessHermesMcpService', () => {
  it('keeps explicit origin-department filtering separate from free-text treatment mentions', async () => {
    const machineOrigin = {
      id: 'nc-machine', nonconformityNo: 'NC-MACHINE', partNumber: null, partName: '品名', machineName: '機械',
      originDepartmentCode: 'D-MACHINE', originDepartmentName: '機械課', discoveredOn: new Date('2026-09-02T00:00:00Z'),
      nonconformityContent: '寸法差', remarks: null, correctiveContent1: null, correctiveContent2: null,
      dispositionContent: '機械課で処置', sourceUpdatedOn: new Date('2026-09-02T00:00:00Z')
    };
    const otherOrigin = { ...machineOrigin, id: 'nc-other', nonconformityNo: 'NC-OTHER', originDepartmentCode: 'D-DESIGN', originDepartmentName: '機構設計課' };
    const findMany = vi.fn(async ({ where }: { where: Record<string, unknown> }) => (
      where.originDepartmentName ? [machineOrigin] : [otherOrigin, machineOrigin]
    ));
    const db = {
      scawStfutekigoCurrent: { findMany, findFirst: vi.fn().mockResolvedValue(machineOrigin), count: vi.fn().mockResolvedValue(1) }
    };
    const service = new BusinessHermesMcpService({ db: db as never, workInstructions: {} as never });
    const response = await service.call('business_hermes_search', {
      kind: 'nonconformity', query: '機械課', originDepartmentName: '機械課', limit: 3
    });
    const payload = JSON.parse(response.content[0]?.text ?? '{}') as { results: Array<Record<string, unknown>> };
    expect(payload.results.map((result) => result.nonconformityNo)).toEqual(['NC-MACHINE']);
    expect(payload.results[0]).toMatchObject({ evidenceKey: 'nonconformity:nc-machine' });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      originDepartmentName: { contains: '機械課', mode: 'insensitive' },
      OR: expect.arrayContaining([{ dispositionContent: { contains: '機械課', mode: 'insensitive' } }])
    }) }));
    const detail = await service.call('business_hermes_get_detail', { kind: 'nonconformity', id: 'nc-machine' });
    expect(JSON.parse(detail.content[0]?.text ?? '{}')).toMatchObject({ evidenceKey: 'nonconformity:nc-machine' });
  });

  it('searches effective public text and keeps both source kinds visible', async () => {
    const db = {
      scawStfutekigoCurrent: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'nc-1', nonconformityNo: 'NC-1', partNumber: 'PN-1', partName: '品名', machineName: '機械', originDepartmentCode: 'D-01', originDepartmentName: '機構設計１課',
          discoveredOn: new Date('2026-09-01T00:00:00Z'), nonconformityContent: 'condition', remarks: null,
          correctiveContent1: null, correctiveContent2: null, dispositionContent: null, sourceUpdatedOn: new Date('2026-09-01T00:00:00Z')
        }]),
        count: vi.fn().mockResolvedValue(4)
      },
      workInstructionSourcePublication: { findUnique: vi.fn().mockResolvedValue({ publishedVersion: { partNumber: 'PN-1', shootingTarget: '切削' } }) }
    };
    const readPublishedGroups = vi.fn().mockResolvedValue([{ partNumber: 'PN-1', shootingTarget: '切削', rowCount: 1, stepCount: 1, latestModified: new Date('2026-09-01T00:00:00Z') }]);
    const searchPublishedGroups = vi.fn().mockResolvedValue({ groups: [{ partNumber: 'PN-1', shootingTarget: '切削', rowCount: 1, stepCount: 1, latestModified: new Date('2026-09-01T00:00:00Z') }], total: 1, hasMore: false });
    const readPublishedGroup = vi.fn().mockResolvedValue({
      partNumber: 'PN-1', shootingTarget: '切削', rows: [{ id: 'row-1', source: { system: 'sharepoint', list: 'wi', itemId: 1, modified: new Date('2026-09-01T00:00:00Z') }, steps: [{ id: 'step-1', step: 1, text: '旧本文', memoOverride: '', imageAssetId: null, imageMimeType: null, overlays: [] }] }]
    });
    const service = new BusinessHermesMcpService({ db: db as never, workInstructions: { readPublishedGroups, readPublishedGroup, searchPublishedGroups } });
    const response = await service.call('business_hermes_search', { query: 'PN-1', kind: 'both', limit: 2 });
    const payload = JSON.parse(response.content[0]?.text ?? '{}') as { results: Array<Record<string, unknown>>; total: number };
    expect(payload.total).toBe(5);
    expect(payload.results.map((item) => item.kind)).toEqual(['nonconformity', 'work_instruction']);
    expect(payload.results[0]).toMatchObject({ evidenceKey: 'nonconformity:nc-1' });
    expect((payload.results[1]?.rows as Array<{ steps: Array<Record<string, unknown>> }>)[0]?.steps[0]).toMatchObject({ evidenceKey: 'work_instruction:step-1' });
    expect(readPublishedGroup).toHaveBeenCalledWith({ partNumber: 'PN-1', shootingTarget: '切削' });

    const originFiltered = await service.call('business_hermes_search', { kind: 'nonconformity', originDepartmentCode: 'D-01', originDepartmentName: '機構設計', limit: 1 });
    const originPayload = JSON.parse(originFiltered.content[0]?.text ?? '{}') as { results: Array<Record<string, unknown>> };
    expect(db.scawStfutekigoCurrent.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        originDepartmentCode: 'D-01',
        originDepartmentName: { contains: '機構設計', mode: 'insensitive' }
      }),
      orderBy: [{ discoveredOn: { sort: 'desc', nulls: 'last' } }, { nonconformityNo: 'desc' }]
    }));
    expect(originPayload.results[0]).toMatchObject({ originDepartmentCode: 'D-01', originDepartmentName: '機構設計１課', originDepartmentMeaning: '起因部署' });

    const ncFirst = await service.call('business_hermes_search', { query: 'PN-1', kind: 'both', limit: 1 });
    const ncFirstPayload = JSON.parse(ncFirst.content[0]?.text ?? '{}') as { hasMore: { workInstruction: boolean }; nextCursor: { workInstructionOffset: number | null } };
    expect(ncFirstPayload.hasMore.workInstruction).toBe(true);
    expect(ncFirstPayload.nextCursor.workInstructionOffset).toBe(0);

    const detail = await service.call('business_hermes_get_detail', { kind: 'work_instruction', id: 'row-1' });
    const detailPayload = JSON.parse(detail.content[0]?.text ?? '{}') as { rows: Array<{ steps: Array<Record<string, unknown>> }> };
    expect(detailPayload.rows[0]?.steps[0]).toMatchObject({ effectiveText: '', publicEdited: true, rawImageLabel: null, evidenceKey: 'work_instruction:step-1' });
    expect(detailPayload.rows[0]?.steps[0]).not.toHaveProperty('imageStorageKey');
  });

  it('rejects an unqualified nonconformity detail request', async () => {
    const service = new BusinessHermesMcpService({ db: { scawStfutekigoCurrent: { findMany: vi.fn() } } as never, workInstructions: {} as never });
    const response = await service.call('business_hermes_get_detail', { kind: 'nonconformity' });
    expect(JSON.parse(response.content[0]?.text ?? '{}')).toEqual({ error: 'id is required for nonconformity detail' });
  });

  it('uses the public DB text-search page before loading matching group details', async () => {
    const readPublishedGroups = vi.fn();
    const searchPublishedGroups = vi.fn().mockResolvedValue({
      groups: [
        { partNumber: 'PN-A', shootingTarget: '組立', rowCount: 1, stepCount: 1, latestModified: new Date('2026-09-01T00:00:00Z') },
        { partNumber: 'PN-B', shootingTarget: '組立', rowCount: 1, stepCount: 1, latestModified: new Date('2026-09-01T00:00:00Z') }
      ],
      total: 2,
      hasMore: false
    });
    const readPublishedGroup = vi.fn(async ({ partNumber }: { partNumber: string }) => ({
      partNumber,
      shootingTarget: '組立',
      rows: [{ id: `${partNumber}-row`, source: { system: 'sharepoint', list: 'wi', itemId: 1, modified: new Date('2026-09-01T00:00:00Z') }, steps: [{ id: `${partNumber}-step`, step: 1, text: '公開要領', imageAssetId: null, imageMimeType: null, overlays: [] }] }]
    }));
    const service = new BusinessHermesMcpService({ db: {} as never, workInstructions: { readPublishedGroups, readPublishedGroup, searchPublishedGroups } });
    const response = await service.call('business_hermes_search', { kind: 'work_instruction', query: '公開要領', limit: 1 });
    const payload = JSON.parse(response.content[0]?.text ?? '{}') as { total: number; results: Array<Record<string, unknown>>; nextCursor: { workInstructionOffset: number | null } };
    expect(searchPublishedGroups).toHaveBeenCalledWith({ query: '公開要領', partNumber: undefined, shootingTarget: undefined, limit: 1, offset: 0 });
    expect(readPublishedGroups).not.toHaveBeenCalled();
    expect(payload.total).toBe(2);
    expect(payload.results).toHaveLength(1);
    expect(payload.nextCursor.workInstructionOffset).toBe(1);
  });

  it('walks every DB-search page exactly once and terminates on the final page', async () => {
    const groups = Array.from({ length: 23 }, (_, index) => ({
      partNumber: `PN-${String(index + 1).padStart(2, '0')}`,
      shootingTarget: '組立',
      rowCount: 1,
      stepCount: 1,
      latestModified: new Date('2026-09-01T00:00:00Z')
    }));
    const searchPublishedGroups = vi.fn(async ({ limit, offset }: { limit: number; offset: number }) => ({
      groups: groups.slice(offset, offset + limit),
      total: groups.length,
      hasMore: offset + limit < groups.length
    }));
    const readPublishedGroup = vi.fn(async ({ partNumber }: { partNumber: string }) => ({
      partNumber,
      shootingTarget: '組立',
      rows: [{ id: `${partNumber}-row`, source: { system: 'sharepoint', list: 'wi', itemId: 1, modified: new Date('2026-09-01T00:00:00Z') }, steps: [{ id: `${partNumber}-step`, step: 1, text: '公開要領', imageAssetId: null, imageMimeType: null, overlays: [] }] }]
    }));
    const service = new BusinessHermesMcpService({ db: {} as never, workInstructions: { readPublishedGroups: vi.fn(), readPublishedGroup, searchPublishedGroups } });
    const collected: string[] = [];
    let offset = 0;
    let lastPayload: { results: Array<{ partNumber: string }>; hasMore: { workInstruction: boolean }; nextCursor: { workInstructionOffset: number | null } } | undefined;
    do {
      const response = await service.call('business_hermes_search', { kind: 'work_instruction', query: '公開要領', limit: 10, workInstructionOffset: offset });
      lastPayload = JSON.parse(response.content[0]?.text ?? '{}') as typeof lastPayload;
      collected.push(...lastPayload.results.map((result) => result.partNumber));
      offset = lastPayload.nextCursor.workInstructionOffset ?? -1;
    } while (lastPayload.hasMore.workInstruction);
    expect(collected).toEqual(groups.map((group) => group.partNumber));
    expect(new Set(collected).size).toBe(23);
    expect(lastPayload.nextCursor.workInstructionOffset).toBeNull();
    expect(searchPublishedGroups).toHaveBeenCalledTimes(3);
  });

  it('keeps an unseen catalog WI on the next cursor when NC fills the first both page', async () => {
    const findMany = vi.fn(async ({ skip }: { skip: number }) => skip === 0 ? [{
      id: 'nc-1', nonconformityNo: 'NC-1', partNumber: 'PN-NC', partName: '漏れ', machineName: '機械',
      discoveredOn: new Date('2026-09-01T00:00:00Z'), nonconformityContent: '締付け後の漏れ', remarks: null,
      correctiveContent1: null, correctiveContent2: null, dispositionContent: null, sourceUpdatedOn: new Date('2026-09-01T00:00:00Z')
    }] : []);
    const readPublishedGroups = vi.fn(async ({ offset }: { offset: number }) => offset === 0 ? [
      { partNumber: 'PN-A', shootingTarget: '組立', rowCount: 1, stepCount: 1, latestModified: new Date('2026-09-01T00:00:00Z') },
      { partNumber: 'PN-B', shootingTarget: '組立', rowCount: 1, stepCount: 1, latestModified: new Date('2026-09-01T00:00:00Z') }
    ] : [{ partNumber: 'PN-B', shootingTarget: '組立', rowCount: 1, stepCount: 1, latestModified: new Date('2026-09-01T00:00:00Z') }]);
    const readPublishedGroup = vi.fn(async ({ partNumber }: { partNumber: string }) => ({
      partNumber,
      shootingTarget: '組立',
      rows: [{ id: `${partNumber}-row`, source: { system: 'sharepoint', list: 'wi', itemId: 1, modified: new Date('2026-09-01T00:00:00Z') }, steps: [{ id: `${partNumber}-step`, step: 1, text: '公開要領', imageAssetId: null, imageMimeType: null, overlays: [] }] }]
    }));
    const db = { scawStfutekigoCurrent: { findMany, count: vi.fn().mockResolvedValue(1) } };
    const service = new BusinessHermesMcpService({ db: db as never, workInstructions: { readPublishedGroups, readPublishedGroup, searchPublishedGroups: vi.fn() } });
    const first = JSON.parse((await service.call('business_hermes_search', { kind: 'both', limit: 1 })).content[0]?.text ?? '{}') as { results: Array<{ kind: string }>; nextCursor: { nonconformityOffset: number | null; workInstructionOffset: number | null }; hasMore: { workInstruction: boolean } };
    expect(first.results.map((result) => result.kind)).toEqual(['nonconformity']);
    expect(first.nextCursor).toEqual({ nonconformityOffset: null, workInstructionOffset: 0 });
    expect(first.hasMore.workInstruction).toBe(true);

    const second = JSON.parse((await service.call('business_hermes_search', {
      kind: 'work_instruction', limit: 1, workInstructionOffset: first.nextCursor.workInstructionOffset
    })).content[0]?.text ?? '{}') as { results: Array<{ kind: string; partNumber: string }>; nextCursor: { workInstructionOffset: number | null }; hasMore: { workInstruction: boolean } };
    expect(second.results.map((result) => result.partNumber)).toEqual(['PN-A']);
    expect(second.hasMore.workInstruction).toBe(true);
    expect(second.nextCursor.workInstructionOffset).toBe(1);

    const third = JSON.parse((await service.call('business_hermes_search', {
      kind: 'work_instruction', limit: 1, workInstructionOffset: second.nextCursor.workInstructionOffset
    })).content[0]?.text ?? '{}') as { results: Array<{ partNumber: string }>; nextCursor: { workInstructionOffset: number | null }; hasMore: { workInstruction: boolean } };
    expect(third.results.map((result) => result.partNumber)).toEqual(['PN-B']);
    expect(third.hasMore.workInstruction).toBe(false);
    expect(third.nextCursor.workInstructionOffset).toBeNull();
  });
});
