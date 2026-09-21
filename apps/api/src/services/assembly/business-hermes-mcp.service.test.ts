import { describe, expect, it, vi } from 'vitest';

import { BusinessHermesMcpService, groundedAnswerMessage } from './business-hermes-mcp.service.js';

describe('BusinessHermesMcpService', () => {
  it('resolves an official origin department before applying the requested result limit', async () => {
    const row = {
      id: 'nc-machine', nonconformityNo: '00008196', partNumber: 'MD005195722', partName: 'Ｘ軸ベース', machineName: 'ＤＦＤ',
      originDepartmentCode: '110507051', originDepartmentName: '三島工場製造部機械課', discoveredOn: new Date('2026-09-04T00:00:00Z'),
      nonconformityContent: '加工不良', remarks: null, correctiveContent1: null, correctiveContent2: null,
      dispositionContent: null, sourceUpdatedOn: new Date('2026-09-06T00:00:00Z')
    };
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ value: '三島工場製造部機械課', code: '110507051' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const findMany = vi.fn().mockResolvedValue([row]);
    const db = {
      $queryRaw: queryRaw,
      scawStfutekigoCurrent: { findMany, count: vi.fn().mockResolvedValue(1) }
    };
    const service = new BusinessHermesMcpService({ db: db as never, workInstructions: {} as never });

    const grounded = await service.resolveAndSearch('三島工場製造部機械課の不適合を2件探して');

    expect(grounded.conditions).toEqual({
      kind: 'nonconformity', limit: 2,
      originDepartmentName: '三島工場製造部機械課', originDepartmentCode: '110507051'
    });
    expect(grounded.resolution.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'nonconformity', field: 'originDepartmentName', status: 'resolved', selected: expect.objectContaining({
        value: '三島工場製造部機械課', code: '110507051', source: 'ScawStFutekigoCurrent'
      }) })
    ]));
    expect(queryRaw).toHaveBeenCalledTimes(5);
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({
      isPresentInLatestSnapshot: true,
      originDepartmentName: { contains: '三島工場製造部機械課', mode: 'insensitive' },
      originDepartmentCode: '110507051'
    }), take: 2 }));
    expect(grounded.evidence[0]).toMatchObject({ evidenceKey: 'nonconformity:nc-machine', discoveredOn: '2026-09-04' });
  });

  it('separates nonconformity totals from returned public work-instruction groups for both-source grounding', async () => {
    const row = {
      id: 'nc-1', nonconformityNo: 'NC-1', partNumber: 'PN-1', partName: '品名', machineName: '機械', originDepartmentCode: 'D-01', originDepartmentName: '機構設計課',
      discoveredOn: new Date('2026-09-01T00:00:00Z'), nonconformityContent: 'condition', remarks: null, correctiveContent1: null, correctiveContent2: null,
      dispositionContent: null, sourceUpdatedOn: new Date('2026-09-02T00:00:00Z')
    };
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ value: 'PN-1', code: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ value: 'PN-1' }])
      .mockResolvedValueOnce([{ value: '切削' }]);
    const group = {
      partNumber: 'PN-1', shootingTarget: '切削',
      rows: [
        { id: 'row-1', source: { system: 'sharepoint', list: 'wi', itemId: 1, modified: new Date('2026-09-03T00:00:00Z') }, steps: [{ id: 'step-1', step: 1, text: '公開1', imageAssetId: null, imageMimeType: null, overlays: [] }] },
        { id: 'row-2', source: { system: 'sharepoint', list: 'wi', itemId: 2, modified: new Date('2026-09-03T00:00:00Z') }, steps: [{ id: 'step-2', step: 2, text: '公開2', imageAssetId: null, imageMimeType: null, overlays: [] }] }
      ]
    };
    const service = new BusinessHermesMcpService({ db: {
      $queryRaw: queryRaw,
      scawStfutekigoCurrent: { findMany: vi.fn().mockResolvedValue([row]), count: vi.fn().mockResolvedValue(4) }
    } as never, workInstructions: {
      readPublishedGroups: vi.fn().mockResolvedValue([{ partNumber: 'PN-1', shootingTarget: '切削', rowCount: 2, stepCount: 2, latestModified: new Date('2026-09-03T00:00:00Z') }]),
      readPublishedGroup: vi.fn().mockResolvedValue(group),
      searchPublishedGroups: vi.fn()
    } });

    const grounded = await service.resolveAndSearch('品番PN-1の不適合と公開切削要領を2件');
    expect(grounded.conditions).toMatchObject({ kind: 'both', limit: 2, partNumber: 'PN-1', shootingTarget: '切削' });
    expect(grounded.result?.sourceCounts).toEqual({
      nonconformity: { total: 4, returned: 1, returnedScope: 'returned_page' },
      workInstruction: { total: 1, returned: 1, returnedScope: 'returned_page' }
    });
    expect(grounded.evidence.find((item) => item.kind === 'nonconformity')).toMatchObject({ sourceResultCount: 4, sourceReturnedCount: 1 });
    expect(grounded.evidence.find((item) => item.kind === 'work_instruction')).toMatchObject({ sourceGroupCount: 1, sourceGroupCountScope: 'returned_page', sourceRowCount: 2, sourceGroupTotal: 1 });
    expect(grounded.evidence.find((item) => item.kind === 'work_instruction')).not.toHaveProperty('sourceResultCount');
  });

  it('keeps natural department wording as an official candidate until confirmed', async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ value: '三島工場製造部機械課', code: '110507051' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new BusinessHermesMcpService({ db: {
      $queryRaw: queryRaw,
      scawStfutekigoCurrent: { findMany, count: vi.fn().mockResolvedValue(0) }
    } as never, workInstructions: {} as never });

    const grounded = await service.resolveAndSearch('三島工場の機械課の直近の不適合を2件探して');

    expect(grounded.resolution.ambiguous).toBe(true);
    expect(grounded.resolution.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'originDepartmentName', status: 'ambiguous', candidates: [expect.objectContaining({ value: '三島工場製造部機械課' })] })
    ]));
    expect(grounded.conditions).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('does not choose between multiple official values that match equally', async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { value: '三島工場製造部機械課', code: 'D-MISHIMA' },
        { value: '大阪工場製造部機械課', code: 'D-OSAKA' }
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const findMany = vi.fn();
    const service = new BusinessHermesMcpService({ db: {
      $queryRaw: queryRaw,
      scawStfutekigoCurrent: { findMany, count: vi.fn() }
    } as never, workInstructions: {} as never });

    const grounded = await service.resolveAndSearch('機械課の不適合を調べて');

    expect(grounded.resolution.ambiguous).toBe(true);
    expect(grounded.resolution.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'originDepartmentName', status: 'ambiguous' })
    ]));
    expect(grounded.conditions).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('lets the isolated OpenJev selector resolve an official ambiguous value and narrow returned records', async () => {
    const row = {
      id: 'nc-mishima', nonconformityNo: '00008196', partNumber: 'MD005195722', partName: '品名', machineName: '機械',
      originDepartmentCode: 'D-MISHIMA', originDepartmentName: '三島工場製造部機械課', discoveredOn: new Date('2026-09-04T00:00:00Z'),
      nonconformityContent: '加工不良', remarks: null, correctiveContent1: null, correctiveContent2: null,
      dispositionContent: null, sourceUpdatedOn: new Date('2026-09-06T00:00:00Z')
    };
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { value: '三島工場製造部機械課', code: 'D-MISHIMA' },
        { value: '大阪工場製造部機械課', code: 'D-OSAKA' }
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const selected = vi.fn(async ({ candidates }: { candidates: Array<{ value: string }> }) => candidates.filter((candidate) => candidate.value.startsWith('三島')));
    const selectedResults = vi.fn(async ({ evidence }: { evidence: Array<{ kind: string; id: string }> }) => evidence.slice(0, 1).map((entry) => `${entry.kind}:${entry.id}`));
    const service = new BusinessHermesMcpService({ db: {
      $queryRaw: queryRaw,
      scawStfutekigoCurrent: { findMany: vi.fn().mockResolvedValue([row]), count: vi.fn().mockResolvedValue(1) }
    } as never, workInstructions: {} as never, openJevSelector: {
      selectSourceCandidates: selected,
      selectGroundedResults: selectedResults
    } });

    const context = { history: [{ role: 'assistant', content: '前に選んだ部署の記録', recordIds: ['nonconformity:nc-mishima'] }] };
    const grounded = await service.resolveAndSearch('機械課の不適合を調べて', context);

    expect(selected).toHaveBeenCalledWith(expect.objectContaining({ context }));
    expect(grounded.conditions).toEqual({ kind: 'nonconformity', limit: 10, originDepartmentName: '三島工場製造部機械課', originDepartmentCode: 'D-MISHIMA' });
    expect(grounded.result?.results).toHaveLength(1);
    expect(selectedResults).toHaveBeenCalledWith(expect.objectContaining({ request: '機械課の不適合を調べて', context }));
    await service.resolveAndSearchPlanned('その品番の記録', { kind: 'nonconformity', limit: 1, partNumber: row.partNumber }, context);
    expect(selectedResults).toHaveBeenLastCalledWith(expect.objectContaining({ request: 'その品番の記録', context }));
    await service.resolveAndSearchPlanned('別の相談', { kind: 'nonconformity', limit: 1 });
    expect(selectedResults).toHaveBeenLastCalledWith(expect.objectContaining({ request: '別の相談', context: undefined }));
  });

  it('does not resolve an official value when a requested formal term is absent', async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ value: '三島工場製造部機械課', code: 'D-MISHIMA' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const findMany = vi.fn();
    const service = new BusinessHermesMcpService({ db: {
      $queryRaw: queryRaw,
      scawStfutekigoCurrent: { findMany, count: vi.fn() }
    } as never, workInstructions: {} as never });

    const grounded = await service.resolveAndSearch('架空工場の機械課の不適合を調べて');

    expect(grounded.resolution.ambiguous).toBe(true);
    expect(grounded.resolution.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'originDepartmentName', status: 'ambiguous' })
    ]));
    expect(grounded.conditions).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('does not reinterpret a date phrase as a source date field', async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const findMany = vi.fn();
    const service = new BusinessHermesMcpService({ db: {
      $queryRaw: queryRaw,
      scawStfutekigoCurrent: { findMany, count: vi.fn() }
    } as never, workInstructions: {} as never });

    const grounded = await service.resolveAndSearch('2025年以降の不適合を調べて');

    expect(grounded.resolution.unresolvedConditions).toEqual(['date']);
    expect(grounded.conditions).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('honors the requested work-instruction source when the same part exists in both sources', async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ value: 'MD000006698', code: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ value: 'MD000006698' }])
      .mockResolvedValueOnce([{ value: '研削' }]);
    const readPublishedGroups = vi.fn().mockResolvedValue([{ partNumber: 'MD000006698', shootingTarget: '研削', rowCount: 1, stepCount: 1, latestModified: new Date('2026-09-01T00:00:00Z') }]);
    const readPublishedGroup = vi.fn().mockResolvedValue({
      partNumber: 'MD000006698', shootingTarget: '研削', rows: [{ id: 'row-1', source: { system: 'sharepoint', list: 'wi', itemId: 1, modified: new Date('2026-09-01T00:00:00Z') }, steps: [{ id: 'step-1', step: 1, text: '公開要領', imageAssetId: null, imageMimeType: null, overlays: [] }] }]
    });
    const service = new BusinessHermesMcpService({ db: {
      $queryRaw: queryRaw,
      scawStfutekigoCurrent: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) }
    } as never, workInstructions: { readPublishedGroups, readPublishedGroup, searchPublishedGroups: vi.fn() } });

    const grounded = await service.resolveAndSearch('品番MD000006698の公開されている研削の作業要領を教えて');

    expect(grounded.conditions).toMatchObject({ kind: 'work_instruction', partNumber: 'MD000006698', shootingTarget: '研削' });
    expect(grounded.conditions).not.toMatchObject({ kind: 'both' });
    expect(grounded.evidence).toEqual([expect.objectContaining({ id: 'step-1', kind: 'work_instruction', partNumber: 'MD000006698', shootingTarget: '研削' })]);
  });

  it('adds the source contract without dropping the existing describe response fields', async () => {
    const service = new BusinessHermesMcpService({ db: {} as never, workInstructions: {} as never });
    const response = await service.call('business_hermes_describe_sources', {});
    const payload = JSON.parse(response.content[0]?.text ?? '{}') as {
      sources: Array<{ kind: string; fields: string[]; fieldDefinitions: Array<{ name: string }>; fieldMeanings: Record<string, string>;
        relationKeys: Array<{ key: string; target: string }>; operations: Array<{ name: string }>; rules: string[]; responsibilityDepartment?: string }>;
    };
    const nonconformity = payload.sources.find((source) => source.kind === 'nonconformity')!;
    const workInstruction = payload.sources.find((source) => source.kind === 'work_instruction')!;
    expect(nonconformity.fields).toEqual(expect.arrayContaining(['id', 'evidenceKey', 'provenance', 'discoveredOn', 'sourceVersionDate']));
    expect(nonconformity.fieldDefinitions.map((field) => field.name)).toEqual(expect.arrayContaining(['condition', 'disposition', 'discoveredOn']));
    expect(nonconformity.fieldMeanings).toMatchObject({ id: '内部レコード識別子', provenance: expect.any(String) });
    expect(nonconformity.responsibilityDepartment).toContain('提供されていません');
    expect(nonconformity.relationKeys).toEqual([expect.objectContaining({ key: 'partNumber', target: 'work_instruction.partNumber' })]);
    expect(nonconformity.operations.map((operation) => operation.name)).toEqual([
      'business_hermes_describe_sources', 'business_hermes_search', 'business_hermes_get_detail'
    ]);
    expect(workInstruction.fields).toEqual(expect.arrayContaining(['id', 'publishedVersionId', 'steps.evidenceKey']));
    expect(workInstruction.rules).toEqual(expect.arrayContaining(['latest imported drafts are excluded']));
  });

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
    expect(JSON.parse(detail.content[0]?.text ?? '{}')).toEqual(payload.results[0]);
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
    const payload = JSON.parse(response.content[0]?.text ?? '{}') as { results: Array<Record<string, unknown>>; total: number; sourceCounts: Record<string, { total: number | null; returned: number; returnedScope: string }> };
    expect(payload.total).toBe(5);
    expect(payload.sourceCounts).toEqual({
      nonconformity: { total: 4, returned: 1, returnedScope: 'returned_page' },
      workInstruction: { total: 1, returned: 1, returnedScope: 'returned_page' }
    });
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

    await service.call('business_hermes_search', {
      kind: 'nonconformity', partName: '品名', machineName: '機械',
      originDepartmentNames: ['三島工場', '機械課'], limit: 1
    });
    expect(db.scawStfutekigoCurrent.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        partName: '品名',
        machineName: '機械',
        AND: [
          { originDepartmentName: { contains: '三島工場', mode: 'insensitive' } },
          { originDepartmentName: { contains: '機械課', mode: 'insensitive' } },
        ],
      }),
    }));

    await service.call('business_hermes_search', {
      kind: 'nonconformity',
      exactExclude: { partName: '品名' }, excludeOriginDepartmentNames: ['機構設計'], limit: 1
    });
    expect(db.scawStfutekigoCurrent.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        NOT: { OR: [
          { partName: { in: ['品名'] } },
          { originDepartmentName: { contains: '機構設計', mode: 'insensitive' } },
        ] },
      }),
    }));

    const ncFirst = await service.call('business_hermes_search', { query: 'PN-1', kind: 'both', limit: 1 });
    const ncFirstPayload = JSON.parse(ncFirst.content[0]?.text ?? '{}') as { hasMore: { workInstruction: boolean }; nextCursor: { workInstructionOffset: number | null } };
    expect(ncFirstPayload.hasMore.workInstruction).toBe(true);
    expect(ncFirstPayload.nextCursor.workInstructionOffset).toBe(0);

    const detail = await service.call('business_hermes_get_detail', { kind: 'work_instruction', id: 'row-1' });
    const detailPayload = JSON.parse(detail.content[0]?.text ?? '{}') as { rows: Array<{ steps: Array<Record<string, unknown>> }> };
    expect(detailPayload.rows[0]?.steps[0]).toMatchObject({ effectiveText: '', publicEdited: true, rawImageLabel: null, evidenceKey: 'work_instruction:step-1' });
    expect(detailPayload.rows[0]?.steps[0]).not.toHaveProperty('imageStorageKey');
    const exported = await service.call('business_hermes_search', { kind: 'work_instruction' });
    expect(JSON.parse(exported.content[0]!.text).results[0]).toEqual(detailPayload);
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

  it('keeps grounded answer claims aligned with the actual record-card selection', () => {
    const grounding = {
      resolution: { version: 1 as const, request: '公開要領', terms: ['公開要領'], requestedKinds: ['work_instruction' as const], requestedLimit: 1, unresolvedConditions: [], fields: [], ambiguous: false },
      conditions: { kind: 'work_instruction' as const, limit: 1 },
      result: { results: [], total: 0, limit: 1 },
      evidence: [{ kind: 'work_instruction', id: 'step-1', partNumber: 'PN-1', shootingTarget: '切削', sourceGroupCount: 1, sourceRowCount: 2 }]
    };
    expect(groundedAnswerMessage(grounding, { recordCount: 0 })).toContain('記録カードの表示指定はありません。');
    expect(groundedAnswerMessage(grounding, { recordCount: 1, recordView: 'summary' })).toContain('概要表示です。原文は詳細表示で確認できます。');
    expect(groundedAnswerMessage(grounding, { recordCount: 1, recordView: 'detail' })).toContain('選択した記録カードに原文を表示します。');
  });

});
