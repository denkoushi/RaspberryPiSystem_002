import { afterEach, describe, expect, it, vi } from 'vitest';

import { env } from '../../config/env.js';

import { BusinessHermesConsultationService } from './business-hermes-consultation.service.js';
import { CACHED_QUESTION_PREFIX, SOURCE_QUESTION_PREFIX } from './business-hermes-answer-cache.js';
import { projectTrustedEvidence } from './business-hermes-evidence.js';
import { signageToolProposal } from './business-hermes-responses.js';

const consultationId = '00000000-0000-0000-0000-000000000010';

// Existing projection/runtime tests exercise a continuing consultation.
function dbFixture(newConsultation = false, fixtureId = consultationId) {
  const messages: Array<{ id: string; role: string; content: string; evidence: unknown; confirmation?: unknown; searchDiagnostics?: unknown; createdAt: Date }> = [];
  const row = {
    id: fixtureId,
    title: null,
    relatedIdentifiers: [],
    confirmedFacts: [],
    openQuestions: [],
    summary: null as string | null,
    hermesConversationId: 'hermes-conversation-1',
    updatedAt: new Date(),
    messages
  };
  const db = {
    businessHermesConsultation: {
      findUnique: vi.fn(async (input: { select?: unknown }) => input.select ? { hermesConversationId: row.hermesConversationId } : { ...row, messages: [...messages].reverse().concat(newConsultation ? [] : [{ id: 'previous-user', role: 'user', content: '以前の相談', evidence: [], createdAt: new Date(0) }]) }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { Object.assign(row, data); row.updatedAt = new Date(); return row; }),
      create: vi.fn()
    },
      businessHermesConsultationMessage: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; consultationId: string; role: string } }) => where.consultationId === fixtureId ? messages.find((m) => m.id === where.id && m.role === where.role) ?? null : null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = messages.find((entry) => entry.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      create: vi.fn(async ({ data }: { data: { role: string; content: string; evidence: unknown; confirmation?: unknown; searchDiagnostics?: unknown } }) => {
        const message = { id: `message-${messages.length + 1}`, ...data, createdAt: new Date(Date.now() + messages.length) };
        messages.push(message);
        return message;
      })
    },
    workInstructionAsset: {
      findMany: vi.fn().mockResolvedValue([{ id: 'asset-1', mimeType: 'image/jpeg' }])
    }
  };
  return { db, row, messages };
}

function ambiguousSourceGrounding(request: string, values: ReadonlyArray<string>): BusinessHermesGroundedSearch {
  const candidates = values.map((value, index) => ({ kind: 'nonconformity' as const, field: 'originDepartmentName', value,
    code: `D-${index + 1}`, source: 'test', matchedTerms: ['機械課'] }));
  return {
    resolution: { version: 1, request, terms: ['機械課'], requestedKinds: ['nonconformity'], requestedLimit: 2,
      unresolvedConditions: [], ambiguous: true,
      fields: [{ kind: 'nonconformity', field: 'originDepartmentName', status: 'ambiguous', candidates }] },
    conditions: null, result: null, evidence: []
  };
}

function resolvedSourceGrounding(request: string, kind: 'nonconformity' | 'work_instruction', conditions: Readonly<Record<string, string | number>>): BusinessHermesGroundedSearch {
  return {
    resolution: { version: 1, request, terms: [], requestedKinds: [kind], requestedLimit: Number(conditions.limit ?? 10),
      unresolvedConditions: [], fields: [], ambiguous: false },
    conditions, result: { results: [], total: 0, limit: Number(conditions.limit ?? 10) }, evidence: []
  };
}

describe('BusinessHermesConsultationService', () => {
  it('runs the isolated OpenJev purpose and one-load responder without double source search or prefetch', async () => {
    const fixture = dbFixture(true);
    const evidence = {
      kind: 'nonconformity', id: 'nc-1', evidenceKey: 'nonconformity:nc-1', nonconformityNo: '00008196', partNumber: 'MD-1',
      originDepartmentName: '三島工場製造部機械課', discoveredOn: '2026-09-04', sourceVersionDate: '2026-09-06', text: '加工不良'
    };
    const grounding = {
      resolution: { version: 1 as const, request: '三島工場の機械課', terms: ['機械課'], requestedKinds: ['nonconformity' as const], requestedLimit: 1,
        unresolvedConditions: [], fields: [{ kind: 'nonconformity' as const, field: 'originDepartmentName', status: 'resolved' as const,
          candidates: [{ kind: 'nonconformity' as const, field: 'originDepartmentName', value: '三島工場製造部機械課', code: 'A', source: 'test', matchedTerms: ['機械課'] }],
          selected: { kind: 'nonconformity' as const, field: 'originDepartmentName', value: '三島工場製造部機械課', code: 'A', source: 'test', matchedTerms: ['機械課'] } }], ambiguous: false },
      conditions: { kind: 'nonconformity', limit: 1, originDepartmentName: '三島工場製造部機械課' },
      result: { results: [{ kind: 'nonconformity', id: 'nc-1', originDepartmentName: '三島工場製造部機械課' }], total: 1, limit: 1,
        sourceCounts: { nonconformity: { total: 1, returned: 1, returnedScope: 'returned_page' } } },
      evidence: [evidence]
    };
    const selectIntent = vi.fn().mockImplementation(async ({ options }: { options: ReadonlyArray<string> }) => options[0]);
    const resolveAndSearch = vi.fn().mockResolvedValue(grounding);
    const generate = vi.fn().mockResolvedValue({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ message: '根拠を確認しました。', needsClarification: false }) }] }] });
    const answerCache = { suggest: vi.fn().mockResolvedValue(null), candidates: vi.fn().mockResolvedValue([]), answer: vi.fn() };
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, answerCache,
      sourceResolver: { resolveAndSearch }, openJevIntentSelector: { selectIntent }, openJevResponder: { generate } });

    const result = await service.chat({ consultationId, message: '三島工場の機械課の不適合を探して' });

    expect(result.status).toBe('ready');
    expect(result.message).toContain('不適合を1件確認しました');
    expect(selectIntent).toHaveBeenCalledTimes(1);
    expect(resolveAndSearch).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(fixture.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('grounds a fresh natural Chat turn without requiring evaluator-selected choices and preserves the generated answer', async () => {
    const fixture = dbFixture(true);
    const openJevGrounder = vi.fn().mockResolvedValue(undefined);
    const generate = vi.fn().mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ message: '参照対象を指定してください。', needsClarification: true }) });
    const sourceResolver = { resolveAndSearch: vi.fn() };
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, sourceResolver,
      openJevGrounder, openJevResponder: { generate }, answerCache: { suggest: vi.fn(), answer: vi.fn() } });
    const response = await service.chat({ consultationId, message: 'この資料の日付の意味を教えて' });
    expect(openJevGrounder).toHaveBeenCalledWith({ request: 'この資料の日付の意味を教えて', references: [], history: [] });
    expect(sourceResolver.resolveAndSearch).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(response.clarificationMessage).toBe('参照対象を指定してください。');
    expect(response.confirmation).toBeUndefined();
    expect(fixture.messages.map((entry) => entry.role)).toEqual(['user', 'assistant']);
  });

  it('keeps the original request and limit when a natural source candidate is selected', async () => {
    const fixture = dbFixture(true);
    const original = '三島工場の機械課の不適合を2件探して';
    const officialDepartment = '三島工場製造部機械課';
    const requests: string[] = [];
    const openJevGrounder = vi.fn(async ({ request }: { request: string }) => {
      requests.push(request);
      return requests.length === 1
        ? ambiguousSourceGrounding(request, [officialDepartment, '大阪工場製造部機械課'])
        : resolvedSourceGrounding(request, 'nonconformity', { kind: 'nonconformity', limit: 2, originDepartmentName: officialDepartment });
    });
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, openJevGrounder,
      openJevResponder: { generate: vi.fn().mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ message: '確認しました。', needsClarification: false }) }) },
      answerCache: { suggest: vi.fn(), answer: vi.fn() } });

    const first = await service.chat({ consultationId, message: original });
    const selection = { prompt: first.confirmation!.prompt, option: officialDepartment };
    const result = await service.chat({ consultationId, message: officialDepartment, selection });

    expect(result.needsClarification).toBe(false);
    expect(requests).toEqual([original, `${original}\n${officialDepartment}`]);
  });

  it('does not prepend a pending source question to a free-text topic change', async () => {
    const fixture = dbFixture(true);
    const original = '三島工場の機械課の不適合を2件探して';
    const changedTopic = '品番MD000006698の公開されている研削の作業要領の内容を教えて';
    const requests: string[] = [];
    const openJevGrounder = vi.fn(async ({ request }: { request: string }) => {
      requests.push(request);
      return requests.length === 1
        ? ambiguousSourceGrounding(request, ['三島工場製造部機械課', '大阪工場製造部機械課'])
        : resolvedSourceGrounding(request, 'work_instruction', { kind: 'work_instruction', limit: 10, partNumber: 'MD000006698', shootingTarget: '研削' });
    });
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, openJevGrounder,
      openJevResponder: { generate: vi.fn().mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ message: '要領を確認しました。', needsClarification: false }) }) },
      answerCache: { suggest: vi.fn(), answer: vi.fn() } });

    const first = await service.chat({ consultationId, message: original });
    expect(first.needsClarification).toBe(true);
    const result = await service.chat({ consultationId, message: changedTopic });

    expect(result.needsClarification).toBe(false);
    expect(requests).toEqual([original, changedTopic]);
    expect(openJevGrounder.mock.calls[1]![0].history).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: original })
    ]));
  });

  it('retains the root request through consecutive source candidate confirmations', async () => {
    const fixture = dbFixture(true);
    const original = '三島工場の機械課の不適合を2件探して';
    const candidateA = '三島工場製造部機械課';
    const candidateB = '大阪工場製造部機械課';
    const requests: string[] = [];
    const openJevGrounder = vi.fn(async ({ request }: { request: string }) => {
      requests.push(request);
      if (requests.length === 1) return ambiguousSourceGrounding(request, [candidateA, candidateB]);
      if (requests.length === 2) return ambiguousSourceGrounding(request, [candidateB, '名古屋工場製造部機械課']);
      return resolvedSourceGrounding(request, 'nonconformity', { kind: 'nonconformity', limit: 2, originDepartmentName: candidateB });
    });
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, openJevGrounder,
      openJevResponder: { generate: vi.fn().mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ message: '確認しました。', needsClarification: false }) }) },
      answerCache: { suggest: vi.fn(), answer: vi.fn() } });

    const first = await service.chat({ consultationId, message: original });
    const firstSelection = { prompt: first.confirmation!.prompt, option: candidateA };
    const second = await service.chat({ consultationId, message: candidateA, selection: firstSelection });
    const secondSelection = { prompt: second.confirmation!.prompt, option: candidateB };
    const result = await service.chat({ consultationId, message: candidateB, selection: secondSelection });

    expect(result.needsClarification).toBe(false);
    expect(requests).toEqual([original, `${original}\n${candidateA}`, `${original}\n${candidateB}`]);
  });

  it('preserves an earlier resolved department while a later source candidate confirms the part number', async () => {
    const fixture = dbFixture(true);
    const original = '三島工場の機械課で品番MD000006698の不適合を2件探して';
    const department = '三島工場製造部機械課';
    const partNumber = 'MD000006698';
    const requests: string[] = [];
    const histories: Array<ReadonlyArray<{ role: string; content: string; recordIds?: string[] }>> = [];
    const departmentCandidate = { kind: 'nonconformity' as const, field: 'originDepartmentName', value: department,
      code: '110507051', source: 'test', matchedTerms: ['機械課'] };
    const partCandidate = { kind: 'nonconformity' as const, field: 'partNumber', value: partNumber,
      source: 'test', matchedTerms: [partNumber] };
    const openJevGrounder = vi.fn(async ({ request, history }: { request: string; history: ReadonlyArray<{ role: string; content: string; recordIds?: string[] }> }) => {
      requests.push(request);
      histories.push(history);
      if (requests.length === 1) return {
        resolution: { version: 1 as const, request, terms: [], requestedKinds: ['nonconformity' as const], requestedLimit: 2,
          unresolvedConditions: [], ambiguous: true,
          fields: [{ kind: 'nonconformity' as const, field: 'originDepartmentName', status: 'ambiguous' as const, candidates: [departmentCandidate] }] },
        conditions: null, result: null, evidence: []
      };
      if (requests.length === 2) return {
        resolution: { version: 1 as const, request, terms: [], requestedKinds: ['nonconformity' as const], requestedLimit: 2,
          unresolvedConditions: [], ambiguous: true,
          fields: [
            { kind: 'nonconformity' as const, field: 'originDepartmentName', status: 'resolved' as const, candidates: [departmentCandidate], selected: departmentCandidate },
            { kind: 'nonconformity' as const, field: 'partNumber', status: 'ambiguous' as const, candidates: [partCandidate] }
          ] },
        conditions: null, result: null, evidence: []
      };
      return {
        resolution: { version: 1 as const, request, terms: [], requestedKinds: ['nonconformity' as const], requestedLimit: 2,
          unresolvedConditions: [], ambiguous: false,
          fields: [
            { kind: 'nonconformity' as const, field: 'originDepartmentName', status: 'resolved' as const, candidates: [departmentCandidate], selected: departmentCandidate },
            { kind: 'nonconformity' as const, field: 'partNumber', status: 'resolved' as const, candidates: [partCandidate], selected: partCandidate }
          ] },
        conditions: { kind: 'nonconformity', limit: 2, originDepartmentName: department, originDepartmentCode: '110507051', partNumber },
        result: { results: [], total: 0, limit: 2 }, evidence: []
      };
    });
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, openJevGrounder,
      openJevResponder: { generate: vi.fn().mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ message: '確認しました。', needsClarification: false }) }) },
      answerCache: { suggest: vi.fn(), answer: vi.fn() } });

    const first = await service.chat({ consultationId, message: original });
    const firstSelection = { prompt: first.confirmation!.prompt, option: department };
    const second = await service.chat({ consultationId, message: department, selection: firstSelection });
    const secondSelection = { prompt: second.confirmation!.prompt, option: partNumber };
    const result = await service.chat({ consultationId, message: partNumber, selection: secondSelection });

    expect(result.needsClarification).toBe(false);
    expect(requests).toEqual([original, `${original}\n${department}`, `${original}\n${partNumber}`]);
    expect(histories[2]).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: `「${department}」が選択されました。` })
    ]));
    const finalUserMessage = fixture.messages.at(-2);
    const finalDiagnostics = finalUserMessage?.searchDiagnostics as Array<Record<string, unknown>> | undefined;
    expect(finalDiagnostics?.find((entry) => entry.kind === 'business-hermes-source-resolution-v1')?.conditions).toEqual({
      kind: 'nonconformity', limit: 2, originDepartmentName: department, originDepartmentCode: '110507051', partNumber
    });
  });

  it('retains authoritative facts when the isolated natural-Chat generator invents units and counts', async () => {
    const fixture = dbFixture(true);
    const evidence = { kind: 'nonconformity', id: 'nc-fact', evidenceKey: 'nonconformity:nc-fact',
      nonconformityNo: 'NC-FACT', partNumber: 'PN-FACT', condition: 'ずれ0.7', disposition: null,
      sourceResultCount: 1, sourceReturnedCount: 1 };
    const grounding = {
      resolution: { version: 1 as const, request: 'この品番の不適合を探して', terms: [],
        requestedKinds: ['nonconformity' as const], requestedLimit: 1, unresolvedConditions: [], fields: [], ambiguous: false },
      conditions: { kind: 'nonconformity', limit: 1, partNumber: 'PN-FACT' },
      result: { results: [evidence], total: 1, limit: 1,
        sourceCounts: { nonconformity: { total: 1, returned: 1, returnedScope: 'returned_page' } } },
      evidence: [evidence]
    };
    const service = new BusinessHermesConsultationService({ db: fixture.db as never,
      openJevGrounder: async () => grounding,
      openJevResponder: { generate: async () => ({ status: 'completed', output_text: JSON.stringify({
        message: '全999件で、ずれは0.7mmです。処置は未実施です。', needsClarification: false
      }) }) }, answerCache: { suggest: vi.fn(), answer: vi.fn() } });
    const result = await service.chat({ consultationId, message: 'この品番の不適合を探して' });
    expect(result.status).toBe('ready');
    expect(result.message).toContain('不適合を1件確認しました');
    expect(result.message).not.toMatch(/999|mm|未実施/);
    expect(result.recordIds).toEqual(['nonconformity:nc-fact']);
    expect(JSON.stringify(result.evidence)).toContain('ずれ0.7');
    expect(JSON.stringify(result.evidence)).not.toContain('0.7mm');
  });

  it('carries stored source facts and history into a causal follow-up without replacing its direct answer', async () => {
    const fixture = dbFixture();
    const record = {
      kind: 'nonconformity', id: 'nc-follow-up', evidenceKey: 'nonconformity:nc-follow-up',
      nonconformityNo: 'NC-FOLLOW-UP', partNumber: 'PN-FOLLOW-UP', originDepartmentName: '三島工場製造部機械課',
      condition: '加工不良', remarks: null, correctiveContent: null, disposition: '再検査', discoveredOn: '2026-09-04', sourceVersionDate: '2026-09-06',
      text: '加工不良'
    };
    const grounding = {
      resolution: { version: 1 as const, request: 'PN-FOLLOW-UPの不適合', terms: ['PN-FOLLOW-UP', '不適合'], requestedKinds: ['nonconformity' as const], requestedLimit: 1,
        unresolvedConditions: [], fields: [], ambiguous: false },
      conditions: { kind: 'nonconformity' as const, limit: 1, partNumber: 'PN-FOLLOW-UP' },
      result: { results: [record], total: 1, limit: 1, sourceCounts: { nonconformity: { total: 1, returned: 1, returnedScope: 'returned_page' } } },
      evidence: [record]
    };
    const sourceResolver = { resolveAndSearch: vi.fn()
      .mockResolvedValueOnce(grounding)
      .mockResolvedValue({ resolution: { version: 1 as const, request: 'その原因は？', terms: [], requestedKinds: [], requestedLimit: 10, unresolvedConditions: [], fields: [], ambiguous: false }, conditions: null, result: null, evidence: [] }) };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(completedResponse('記録を確認しました。'))
      .mockResolvedValueOnce(completedResponse('原因は記録されていません。不適合内容は加工不良です。備考は未記録です。'));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, sourceResolver,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });

    await service.chat({ consultationId, message: 'PN-FOLLOW-UPの不適合を確認して' });
    const followUp = await service.chat({ consultationId, message: 'その原因は？' });
    const payload = JSON.parse(JSON.parse(fetchImpl.mock.calls[1]![1].body).input[0].content);

    expect(payload.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: 'PN-FOLLOW-UPの不適合を確認して' }),
      expect.objectContaining({ role: 'assistant', content: '不適合を1件確認しました（返却1件）。不適合番号: NC-FOLLOW-UP。発見日: 2026-09-04。選択した記録カードに原文を表示します。' })
    ]));
    expect(payload.history.at(-1)).toMatchObject({ role: 'assistant', recordIds: ['nonconformity:nc-follow-up'] });
    expect(payload.availableEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ evidenceKey: 'nonconformity:nc-follow-up', condition: '加工不良', remarks: null, disposition: '再検査', discoveredOn: '2026-09-04' })
    ]));
    expect(payload.displayedEvidence).toEqual([
      expect.objectContaining({ evidenceKey: 'nonconformity:nc-follow-up', condition: '加工不良', disposition: '再検査' })
    ]);
    expect(followUp.message).toBe('原因は記録されていません。不適合内容は加工不良です。備考は未記録です。');
    expect(followUp.message).not.toContain('件確認しました');
  });

  it('passes prior source conditions as context without rewriting a contextual follow-up', async () => {
    const fixture = dbFixture();
    const record = {
      kind: 'nonconformity', id: 'nc-same-part', evidenceKey: 'nonconformity:nc-same-part',
      nonconformityNo: 'NC-SAME-PART', partNumber: 'PN-SAME-PART', originDepartmentName: '三島工場製造部機械課',
      condition: '傷', discoveredOn: '2026-09-03', sourceVersionDate: '2026-09-06', text: '傷'
    };
    const grounding = {
      resolution: { version: 1 as const, request: '三島工場製造部機械課の不適合を2件', terms: [], requestedKinds: ['nonconformity' as const], requestedLimit: 2,
        unresolvedConditions: [], fields: [], ambiguous: false },
      conditions: { kind: 'nonconformity' as const, limit: 2, partNumber: 'PN-SAME-PART', originDepartmentName: '三島工場製造部機械課' },
      result: { results: [record], total: 1, limit: 2, sourceCounts: { nonconformity: { total: 1, returned: 1, returnedScope: 'returned_page' } } },
      evidence: [record]
    };
    const sourceResolver = { resolveAndSearch: vi.fn().mockResolvedValue(grounding) };
    const fetchImpl = vi.fn().mockImplementation(async () => completedResponse());
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, sourceResolver, fetchImpl,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });

    await service.chat({ consultationId, message: '三島工場製造部機械課のPN-SAME-PARTの不適合を2件' });
    expect(sourceResolver.resolveAndSearch).toHaveBeenCalledTimes(1);
    expect(fixture.messages.some((entry) => Array.isArray(entry.searchDiagnostics)
      && entry.searchDiagnostics.some((diagnostic) => diagnostic.kind === 'business-hermes-source-resolution-v1'))).toBe(true);
    await service.chat({ consultationId, message: '同じ品番の過去事例は？' });

    expect(sourceResolver.resolveAndSearch.mock.calls[1]![1]).toMatchObject({ previousConditions: { limit: 2 } });
    expect(sourceResolver.resolveAndSearch.mock.calls[1]![0]).toBe('同じ品番の過去事例は？');
    expect(sourceResolver.resolveAndSearch.mock.calls[1]![1]).toMatchObject({
      history: expect.arrayContaining([expect.objectContaining({ content: '三島工場製造部機械課のPN-SAME-PARTの不適合を2件' })]),
      previousConditions: { kind: 'nonconformity', limit: 2, partNumber: 'PN-SAME-PART', originDepartmentName: '三島工場製造部機械課' }
    });
    const nativePayload = JSON.parse(JSON.parse(fetchImpl.mock.calls[1]![1].body).input[0].content);
    expect(nativePayload.request).toBe('同じ品番の過去事例は？');
    expect(nativePayload.previousConditions).toEqual({ kind: 'nonconformity', limit: 2, partNumber: 'PN-SAME-PART', originDepartmentName: '三島工場製造部機械課' });
  });

  it('does not carry the previous target into an explicit part correction', async () => {
    const fixture = dbFixture();
    const record = {
      kind: 'nonconformity', id: 'nc-correction', evidenceKey: 'nonconformity:nc-correction',
      nonconformityNo: 'NC-CORRECTION', partNumber: 'PN-A', originDepartmentName: '三島工場製造部機械課',
      condition: '傷', discoveredOn: '2026-09-03', sourceVersionDate: '2026-09-06', text: '傷'
    };
    const grounding = {
      resolution: { version: 1 as const, request: 'PN-Aの不適合を2件', terms: [], requestedKinds: ['nonconformity' as const], requestedLimit: 2,
        unresolvedConditions: [], fields: [], ambiguous: false },
      conditions: { kind: 'nonconformity' as const, limit: 2, partNumber: 'PN-A', originDepartmentName: '三島工場製造部機械課' },
      result: { results: [record], total: 1, limit: 2, sourceCounts: { nonconformity: { total: 1, returned: 1, returnedScope: 'returned_page' } } },
      evidence: [record]
    };
    const sourceResolver = { resolveAndSearch: vi.fn().mockResolvedValue(grounding) };
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, sourceResolver,
      fetchImpl: vi.fn().mockResolvedValue(completedResponse()), config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });

    await service.chat({ consultationId, message: 'PN-Aの不適合を2件' });
    await service.chat({ consultationId, message: 'PN-Bの過去の不適合を調べて' });

    const correctedRequest = sourceResolver.resolveAndSearch.mock.calls[1]![0];
    expect(correctedRequest).toBe('PN-Bの過去の不適合を調べて');
    expect(sourceResolver.resolveAndSearch.mock.calls[1]![1]).toMatchObject({
      previousConditions: { partNumber: 'PN-A', originDepartmentName: '三島工場製造部機械課' }
    });
  });

  it('offers actual source choices and generates from the selected source without starting Hermes search', async () => {
    const fixture = dbFixture(true);
    const fetchImpl = vi.fn();
    const option = 'この資料で回答：記録00007475：裏面の膨らみ';
    const answerCache = { suggest: vi.fn().mockResolvedValue(null), candidates: vi.fn().mockResolvedValue([option]), answer: vi.fn() };
    const preparedAnswer = { answer: vi.fn().mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ message: '根拠からの回答', needsClarification: false }) }) };
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, answerCache, preparedAnswer,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    const first = await service.chat({ consultationId, message: '裏面が膨らむ事例の対策は？' });
    expect(first.confirmation!.options).toEqual([option, '自分の言葉で補足する']);
    const result = await service.chat({ consultationId, message: option, selection: { prompt: first.confirmation!.prompt, option } });
    expect(result.message).toBe('根拠からの回答');
    expect(preparedAnswer.answer).toHaveBeenCalledWith(option, '裏面が膨らむ事例の対策は？', expect.any(AbortSignal));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends a first-turn signage request to the business Hermes conversation without unrelated question recipes', async () => {
    const fixture = dbFixture(true);
    const scheduleId = '33333333-3333-4333-8333-333333333333';
    const targetId = '11111111-1111-4111-8111-111111111111';
    const proposal = {
      scheduleName: '業務進捗',
      deviceScopeKey: '工場A - 組立1',
      targetClientDeviceIds: [targetId],
      dayOfWeek: [1, 2, 3, 4, 5],
      startTime: '08:00',
      endTime: '17:00',
      priority: 10,
      enabled: true
    };
    const canonicalProposal = { ...proposal, scheduleId };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify({ type: 'response.completed', response: {
      status: 'completed', output_text: JSON.stringify({ message: '設定案です。', needsClarification: false, signageProposal: proposal })
    } })}\n\n`));
    const prepareSignageProposal = vi.fn().mockResolvedValue({
      proposal: canonicalProposal,
      schedule: {
        id: scheduleId, name: proposal.scheduleName, contentType: 'TOOLS', pdfId: null, layoutConfig: null,
        targetClientCount: 1, targetClientDevices: [{ id: targetId, name: '業務キオスク', deviceScopeKey: proposal.deviceScopeKey }],
        targetAllClients: false, deviceScopeKey: proposal.deviceScopeKey, slideIntervalSeconds: null, seibanPerPage: null,
        dayOfWeek: proposal.dayOfWeek, startTime: proposal.startTime, endTime: proposal.endTime,
        priority: proposal.priority, enabled: proposal.enabled
      }
    });
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      signageControl: { prepareSignageProposal, applySignageProposal: vi.fn() } as never,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });

    const result = await service.chat({ consultationId, message: '業務進捗サイネージを設定したい' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fetchImpl.mock.calls[0])).not.toContain('record-answer');
    expect(result.confirmation).toMatchObject({
      title: 'サイネージ設定の確認',
      signageProposal: canonicalProposal,
      options: ['このサイネージ設定を適用する', 'このサイネージ設定は適用しない']
    });
    expect(result.message).toContain('業務キオスク');
    expect(result.needsClarification).toBe(false);
  });

  it('keeps a Hermes signage proposal read-only until an authenticated manager approves it', async () => {
    const fixture = dbFixture();
    const scheduleId = '33333333-3333-4333-8333-333333333333';
    const targetId = '11111111-1111-4111-8111-111111111111';
    const proposal = {
      scheduleName: '業務進捗',
      deviceScopeKey: '工場A - 組立1',
      targetClientDeviceIds: [targetId],
      dayOfWeek: [1, 2, 3, 4, 5],
      startTime: '08:00',
      endTime: '17:00',
      priority: 10,
      enabled: true
    };
    const canonicalProposal = { ...proposal, scheduleId };
    const prepareSignageProposal = vi.fn().mockResolvedValue({
      proposal: canonicalProposal,
      schedule: {
        id: scheduleId, name: '業務進捗', contentType: 'TOOLS', pdfId: null, layoutConfig: null,
        targetClientCount: 1,
        targetClientDevices: [{ id: targetId, name: '業務キオスク', deviceScopeKey: '工場A - 組立1' }],
        targetAllClients: false, deviceScopeKey: '工場A - 組立1', slideIntervalSeconds: null, seibanPerPage: null,
        dayOfWeek: proposal.dayOfWeek, startTime: proposal.startTime, endTime: proposal.endTime,
        priority: proposal.priority, enabled: proposal.enabled
      }
    });
    const fetchImpl = vi.fn().mockImplementation(async () => new Response(`data: ${JSON.stringify({ type: 'response.completed', response: {
      status: 'completed', output_text: JSON.stringify({
        message: 'サイネージ設定案を作成しました。',
        needsClarification: false,
        signageProposal: proposal
      })
    } })}\n\n`));
    const applySignageProposal = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{"action":"created"}' }] });
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      signageControl: { applySignageProposal, prepareSignageProposal } as never,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });

    const proposed = await service.chat({ consultationId, message: '業務進捗サイネージを設定したい' });
    expect(proposed.confirmation).toMatchObject({ signageProposal: canonicalProposal });
    expect(proposed.message).toContain('業務キオスク');
    expect(proposed.message).toContain('08:00〜17:00');
    expect(proposed.message).not.toBe('サイネージ設定案を作成しました。');
    expect(applySignageProposal).not.toHaveBeenCalled();

    const selection = {
      prompt: proposed.confirmation!.prompt,
      option: 'このサイネージ設定を適用する'
    };
    const viewerAttempt = await service.chat({ consultationId, message: selection.option, selection,
      actor: { userId: 'viewer', role: 'VIEWER' } });
    expect(viewerAttempt.reasonCode).toBeUndefined();
    expect(viewerAttempt.confirmation).toMatchObject({ signageProposal: canonicalProposal });
    expect(viewerAttempt.message).toContain('ADMINまたはMANAGER');
    expect(applySignageProposal).not.toHaveBeenCalled();

    const managerApproval = await service.chat({ consultationId, message: selection.option, selection,
      actor: { userId: 'manager', role: 'MANAGER' } });
    expect(managerApproval.message).toBe('サイネージ設定を反映しました。');
    expect(applySignageProposal).toHaveBeenCalledTimes(1);
    expect(applySignageProposal).toHaveBeenCalledWith(canonicalProposal);
    expect(JSON.stringify(fixture.messages)).not.toContain('targetClientKeys');

    await service.chat({ consultationId, message: selection.option, selection,
      actor: { userId: 'manager', role: 'MANAGER' } });
    expect(applySignageProposal).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale proposal selection after a newer proposal replaces it', async () => {
    const fixture = dbFixture();
    const proposalA = { scheduleName: '業務進捗', startTime: '08:00' };
    const proposalB = { scheduleName: '業務進捗', startTime: '09:00' };
    const canonicalA = { ...proposalA, scheduleId: '33333333-3333-4333-8333-333333333333' };
    const canonicalB = { ...proposalB, scheduleId: '33333333-3333-4333-8333-333333333333' };
    const preview = (proposal: typeof canonicalA) => ({
      id: proposal.scheduleId, name: proposal.scheduleName!, contentType: 'TOOLS', pdfId: null, layoutConfig: null,
      targetClientCount: 0, targetClientDevices: [], targetAllClients: true, deviceScopeKey: null,
      slideIntervalSeconds: null, seibanPerPage: null, dayOfWeek: [1], startTime: proposal.startTime!, endTime: '17:00', priority: 1, enabled: true
    });
    const responseFor = (proposal: object) => new Response(`data: ${JSON.stringify({ type: 'response.completed', response: {
      status: 'completed', output_text: JSON.stringify({ message: '設定案です。', needsClarification: false, signageProposal: proposal })
    } })}\n\n`);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(responseFor(proposalA))
      .mockResolvedValueOnce(responseFor(proposalB));
    const prepareSignageProposal = vi.fn()
      .mockResolvedValueOnce({ proposal: canonicalA, schedule: preview(canonicalA) })
      .mockResolvedValueOnce({ proposal: canonicalB, schedule: preview(canonicalB) });
    const applySignageProposal = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{"action":"updated"}' }] });
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      signageControl: { applySignageProposal, prepareSignageProposal } as never,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });

    const first = await service.chat({ consultationId, message: '最初の設定案' });
    const oldSelection = { prompt: first.confirmation!.prompt, option: 'このサイネージ設定を適用する' };
    const newer = await service.chat({ consultationId, message: '別の設定案' });
    const stale = await service.chat({ consultationId, message: oldSelection.option, selection: oldSelection,
      actor: { userId: 'manager', role: 'MANAGER' } });
    expect(stale.reasonCode).toBe('HERMES_INVALID_SELECTION');
    expect(applySignageProposal).not.toHaveBeenCalled();

    const currentSelection = { prompt: newer.confirmation!.prompt, option: oldSelection.option };
    await service.chat({ consultationId, message: currentSelection.option, selection: currentSelection,
      actor: { userId: 'manager', role: 'MANAGER' } });
    expect(applySignageProposal).toHaveBeenCalledWith(canonicalB);
  });

  it('rejects an approval when a nested canvas element changes', async () => {
    const fixture = dbFixture();
    const canvasA = {
      width: 1920, height: 1080, backgroundColor: '#020617',
      elements: [{ id: 'title', kind: 'text', x: 40, y: 30, width: 1840, height: 80, text: '業務進捗' }]
    };
    const canvasB = {
      ...canvasA,
      elements: [{ ...canvasA.elements[0], x: 80 }]
    };
    const proposalA = { scheduleName: '業務進捗', canvas: canvasA };
    const proposalB = { scheduleName: '業務進捗', canvas: canvasB };
    const canonicalA = { ...proposalA, scheduleId: '33333333-3333-4333-8333-333333333333' };
    const canonicalB = { ...proposalB, scheduleId: '33333333-3333-4333-8333-333333333333' };
    const preview = (proposal: typeof canonicalA) => ({
      id: proposal.scheduleId, name: '業務進捗', contentType: 'TOOLS', pdfId: null, layoutConfig: null,
      targetClientCount: 0, targetClientDevices: [], targetAllClients: true, deviceScopeKey: null,
      slideIntervalSeconds: null, seibanPerPage: null, dayOfWeek: [1], startTime: '08:00', endTime: '17:00', priority: 1, enabled: true
    });
    const responseFor = (proposal: object) => new Response(`data: ${JSON.stringify({ type: 'response.completed', response: {
      status: 'completed', output_text: JSON.stringify({ message: '設定案です。', needsClarification: false, signageProposal: proposal })
    } })}\n\n`);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(responseFor(proposalA))
      .mockResolvedValueOnce(responseFor(proposalB));
    const prepareSignageProposal = vi.fn()
      .mockResolvedValueOnce({ proposal: canonicalA, schedule: preview(canonicalA) })
      .mockResolvedValueOnce({ proposal: canonicalB, schedule: preview(canonicalB) });
    const applySignageProposal = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{"action":"updated"}' }] });
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      signageControl: { applySignageProposal, prepareSignageProposal } as never,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });

    const first = await service.chat({ consultationId, message: '最初のcanvas設定案' });
    const oldSelection = { prompt: first.confirmation!.prompt, option: 'このサイネージ設定を適用する' };
    const newer = await service.chat({ consultationId, message: '位置を変えたcanvas設定案' });
    expect(newer.confirmation!.prompt).not.toBe(oldSelection.prompt);

    const stale = await service.chat({ consultationId, message: oldSelection.option, selection: oldSelection,
      actor: { userId: 'manager', role: 'MANAGER' } });
    expect(stale.reasonCode).toBe('HERMES_INVALID_SELECTION');
    expect(applySignageProposal).not.toHaveBeenCalled();

    await service.chat({ consultationId, message: 'このサイネージ設定を適用する',
      selection: { prompt: newer.confirmation!.prompt, option: oldSelection.option },
      actor: { userId: 'manager', role: 'MANAGER' } });
    expect(applySignageProposal).toHaveBeenCalledWith(canonicalB);
  });

  it('rejects a signage approval copied from another consultation', async () => {
    const otherId = '00000000-0000-0000-0000-000000000011';
    const firstFixture = dbFixture();
    const otherFixture = dbFixture(false, otherId);
    const rawProposal = { scheduleName: '業務進捗', startTime: '08:00' };
    const canonicalProposal = { ...rawProposal, scheduleId: '33333333-3333-4333-8333-333333333333' };
    const preparation = {
      proposal: canonicalProposal,
      schedule: {
        id: canonicalProposal.scheduleId, name: '業務進捗', contentType: 'TOOLS', pdfId: null, layoutConfig: null,
        targetClientCount: 0, targetClientDevices: [], targetAllClients: true, deviceScopeKey: null,
        slideIntervalSeconds: null, seibanPerPage: null, dayOfWeek: [1], startTime: '08:00', endTime: '17:00', priority: 1, enabled: true
      }
    };
    const response = new Response(`data: ${JSON.stringify({ type: 'response.completed', response: {
      status: 'completed', output_text: JSON.stringify({ message: '設定案です。', needsClarification: false, signageProposal: rawProposal })
    } })}\n\n`);
    const firstApply = vi.fn();
    const otherApply = vi.fn();
    const firstService = new BusinessHermesConsultationService({ db: firstFixture.db as never,
      fetchImpl: vi.fn().mockResolvedValue(response.clone()),
      signageControl: { applySignageProposal: firstApply, prepareSignageProposal: vi.fn().mockResolvedValue(preparation) } as never,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    const otherService = new BusinessHermesConsultationService({ db: otherFixture.db as never,
      fetchImpl: vi.fn().mockResolvedValue(response.clone()),
      signageControl: { applySignageProposal: otherApply, prepareSignageProposal: vi.fn().mockResolvedValue(preparation) } as never,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });

    const first = await firstService.chat({ consultationId, message: '最初の設定案' });
    await otherService.chat({ consultationId: otherId, message: '別案件の設定案' });
    const copied = await otherService.chat({ consultationId: otherId, message: 'この設定を適用する', selection: {
      prompt: first.confirmation!.prompt, option: 'このサイネージ設定を適用する'
    }, actor: { userId: 'manager', role: 'MANAGER' } });
    expect(copied.reasonCode).toBe('HERMES_INVALID_SELECTION');
    expect(firstApply).not.toHaveBeenCalled();
    expect(otherApply).not.toHaveBeenCalled();
  });

  it('does not apply a signage proposal produced through the answer cache', async () => {
    const fixture = dbFixture(true);
    const proposal = {
      scheduleId: '33333333-3333-4333-8333-333333333333',
      startTime: '09:00'
    };
    const answerCache = {
      suggest: vi.fn().mockResolvedValue('業務進捗サイネージを設定したい'),
      answer: vi.fn().mockResolvedValue({
        status: 'completed',
        output_text: JSON.stringify({ message: '設定案です。', needsClarification: false, signageProposal: proposal })
      })
    };
    const applySignageProposal = vi.fn();
    const prepareSignageProposal = vi.fn().mockResolvedValue({
      proposal,
      schedule: {
        id: proposal.scheduleId, name: '業務進捗', contentType: 'TOOLS', pdfId: null, layoutConfig: null,
        targetClientCount: 0, targetClientDevices: [], targetAllClients: true, deviceScopeKey: null,
        slideIntervalSeconds: null, seibanPerPage: null, dayOfWeek: [1], startTime: proposal.startTime,
        endTime: '17:00', priority: 1, enabled: true
      }
    });
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, answerCache,
      signageControl: { applySignageProposal, prepareSignageProposal } as never,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    const first = await service.chat({ consultationId, message: 'サイネージ設定を確認したい' });
    const selection = { prompt: first.confirmation!.prompt, option: first.confirmation!.options![0]! };
    const result = await service.chat({ consultationId, message: selection.option, selection });
    expect(result.confirmation?.signageProposal).toEqual(proposal);
    expect(applySignageProposal).not.toHaveBeenCalled();
  });

  it('offers a reviewed question and answers its selection without any LLM or prefetch call', async () => {
    const fixture = dbFixture(true);
    const fetchImpl = vi.fn();
    const answerCache = { suggest: vi.fn().mockResolvedValue('部品Aの検査方法は？'),
      answer: vi.fn().mockResolvedValue({ status: 'completed', learning: { canonicalQuestion: '部品Aの検査方法は？', question: '部品Aの検査方法は？', answer: '確認済みの手順', sources: [{ kind: 'nonconformity', id: 'r1', sha256: 'a'.repeat(64) }] }, output_text: JSON.stringify({ message: '確認済みの手順', needsClarification: false }) }), remember: vi.fn().mockResolvedValue(true) };
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, answerCache,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    const first = await service.chat({ consultationId, message: '部品Aはどう検査する？' });
    const selection = { prompt: first.confirmation!.prompt, option: first.confirmation!.options![0]! };
    expect(selection.option).toBe('この質問の回答：部品Aの検査方法は？');
    const result = await service.chat({ consultationId, message: selection.option, selection });
    expect(result.message).toBe('確認済みの手順');
    expect(answerCache.answer).toHaveBeenCalledWith('部品Aの検査方法は？', expect.any(AbortSignal));
    expect(answerCache.remember).toHaveBeenCalledWith(expect.objectContaining({ question: '部品Aはどう検査する？', canonicalQuestion: '部品Aの検査方法は？' }), expect.any(AbortSignal));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fixture.row.hermesConversationId).toBe('hermes-conversation-1');
    expect(fixture.messages[2]!.searchDiagnostics).toEqual([expect.objectContaining({ answerCache: 'hit', inferences: [] })]);
  });

  it('investigates the selected question normally when its cached source changed', async () => {
    const fixture = dbFixture(true);
    const fetchImpl = vi.fn().mockResolvedValue(completedResponse('最新の記録に基づく回答'));
    const answerCache = { suggest: vi.fn().mockResolvedValue('部品Aの検査方法は？'), answer: vi.fn().mockResolvedValue(null) };
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, answerCache,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    const first = await service.chat({ consultationId, message: '部品Aはどう検査する？' });
    const selection = { prompt: first.confirmation!.prompt, option: first.confirmation!.options![0]! };
    const result = await service.chat({ consultationId, message: selection.option, selection });
    expect(result.message).toBe('最新の記録に基づく回答');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fetchImpl.mock.calls[0])).toContain('部品Aの検査方法は？');
  });

  it('automatically saves a grounded turn and accepts feedback only for its persisted assistant message', async () => {
    const fixture = dbFixture(true);
    const option = 'この資料で回答：記録1';
    const learned = { canonicalQuestion: '記録1：対策は？', question: '対策は？', answer: '原文の対策', sources: [{ kind: 'nonconformity', id: 'r1', sha256: 'a'.repeat(64) }] };
    const answerCache = { suggest: vi.fn().mockResolvedValue(null), candidates: vi.fn().mockResolvedValue([option]), answer: vi.fn(), remember: vi.fn().mockResolvedValue(true), feedback: vi.fn().mockResolvedValue(true) };
    const preparedAnswer = { answer: vi.fn().mockResolvedValue({ status: 'completed', learning: learned, output_text: JSON.stringify({ message: learned.answer, needsClarification: false }) }) };
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, answerCache, preparedAnswer });
    const first = await service.chat({ consultationId, message: learned.question });
    const result = await service.chat({ consultationId, message: option, selection: { prompt: first.confirmation!.prompt, option } });
    const answer = result.consultation.messages.at(-1)!;
    expect(answerCache.remember).toHaveBeenCalledWith({ id: answer.id, ...learned }, expect.any(AbortSignal));
    expect(answer.feedback).toBe('pending');
    expect(answer.searchDiagnostics.some((d) => d.kind === 'business-hermes-experience-v1')).toBe(false);
    expect(await service.feedback('another-consultation', answer.id, 'helpful')).toBe(false);
    expect(await service.feedback(consultationId, fixture.messages[0]!.id, 'helpful')).toBe(false);
    expect(answerCache.feedback).not.toHaveBeenCalled();
    expect(await service.feedback(consultationId, answer.id, 'helpful')).toBe(true);
    expect(answerCache.feedback).toHaveBeenCalledWith(answer.id, 'helpful');
    expect((await service.get(consultationId))!.messages.at(-1)!.feedback).toBe('helpful');
    answerCache.feedback.mockResolvedValue(false);
    expect(await service.feedback(consultationId, answer.id, 'unhelpful')).toBe(false);
    expect((await service.get(consultationId))!.messages.at(-1)!.feedback).toBe('helpful');
  });

  afterEach(async () => {
    await new BusinessHermesConsultationService({ db: dbFixture().db as never }).cancel(consultationId);
    vi.useRealTimers();
  });
  it('records adopted prefetch measurements privately without adding inference calls', async () => {
    const fixture = dbFixture(true);
    const fetchImpl = vi.fn().mockImplementation(async () => completedResponse());
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    const first = await service.chat({ consultationId, message: '検査の対策は？' });
    const selection = { prompt: first.confirmation!.prompt, option: first.confirmation!.options![0]! };
    const result = await service.chat({ consultationId, message: selection.option, selection });
    const measurement = (fixture.messages[2]!.searchDiagnostics as Array<Record<string, unknown>>)[0]!;
    expect(measurement).toMatchObject({ phase: 'answer', status: 'ready', recipeId: 'record-answer',
      recipeVersion: '1', prefetch: 'adopted', question: '検査の対策は？', answerMessageId: fixture.messages[3]!.id });
    expect(measurement.elapsedMs).toEqual(expect.any(Number));
    expect(measurement.inferences).toEqual([expect.objectContaining({ elapsedMs: expect.any(Number), runtimeReadyMs: expect.any(Number) })]);
    expect(result.consultation.messages.every((entry) => entry.searchDiagnostics.every((item) => item.kind !== 'business-hermes-learning-v1'))).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('records failed answers rather than treating missing output as success', async () => {
    const fixture = dbFixture();
    const service = new BusinessHermesConsultationService({ db: fixture.db as never,
      fetchImpl: vi.fn().mockResolvedValue(new Response('', { status: 503 })),
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    const result = await service.chat({ consultationId, message: '対策は？' });
    expect(result.status).toBe('unavailable');
    expect(fixture.messages[0]!.searchDiagnostics).toEqual([expect.objectContaining({ status: 'unavailable', reasonCode: 'HERMES_UPSTREAM_UNAVAILABLE' })]);
    expect(fixture.messages).toHaveLength(1);
  });

  it('preserves a valid response when the final telemetry write fails', async () => {
    const fixture = dbFixture();
    fixture.db.businessHermesConsultationMessage.update.mockRejectedValueOnce(new Error('telemetry unavailable'));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never,
      fetchImpl: vi.fn().mockImplementation(async () => completedResponse()),
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    expect((await service.chat({ consultationId, message: '対策は？' })).status).toBe('ready');
  });

  it('does not present a malformed signage proposal as ready', async () => {
    const fixture = dbFixture();
    const service = new BusinessHermesConsultationService({ db: fixture.db as never,
      fetchImpl: vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify({ type: 'response.completed', response: {
        status: 'completed', output_text: JSON.stringify({
          message: 'サイネージの提案ができました。プレビューを確認してください。',
          signageProposal: { scheduleName: '品質確認', a2ui: { layoutMessage: {} } }
        })
      } })}\n\n`)),
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    const result = await service.chat({ consultationId, message: 'サイネージを作成して' });
    expect(result.status).toBe('unavailable');
    expect(result.confirmation).toBeUndefined();
    expect(fixture.messages[0]!.searchDiagnostics).toEqual([
      expect.objectContaining({ reasonCode: 'HERMES_SIGNAGE_PROPOSAL_INVALID' })
    ]);
  });

  it('uses only the validated configuration tool result even if the final answer wraps it incorrectly', async () => {
    const fixture = dbFixture();
    const proposal = { scheduleId: '33333333-3333-4333-8333-333333333333', enabled: false };
    const response = {
      status: 'completed',
      output_text: JSON.stringify({ message: '提案しました', signageProposal: { proposal } }),
      output: [
        { type: 'function_call', call_id: 'config-1', name: 'mcp__business_api__business_hermes_configure_signage_custom_dashboard', arguments: '{}' },
        { type: 'function_call_output', call_id: 'config-1', output: [{ type: 'input_text', text: JSON.stringify({ result: JSON.stringify({ action: 'proposed', proposal }) }) }] }
      ]
    };
    const prepare = vi.fn().mockResolvedValue({ proposal, schedule: {
      id: proposal.scheduleId, name: '品質確認', dayOfWeek: [1], startTime: '08:00', endTime: '17:00',
      priority: 1, enabled: false, targetClientDevices: [], targetClientCount: 1, targetAllClients: false
    } });
    const apply = vi.fn();
    const service = new BusinessHermesConsultationService({ db: fixture.db as never,
      fetchImpl: vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify({ type: 'response.completed', response })}\n\n`)),
      signageControl: { prepareSignageProposal: prepare, applySignageProposal: apply } as never,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    const result = await service.chat({ consultationId, message: 'サイネージを停止して' });
    expect(result.status).toBe('ready');
    expect(result.confirmation?.signageProposal).toEqual(proposal);
    expect(prepare).toHaveBeenCalledWith(proposal);
    expect(apply).not.toHaveBeenCalled();
    response.output[0]!.name = 'mcp__business_api__business_hermes_search';
    expect(signageToolProposal(response)).toBeUndefined();
  });

  it('offers persisted question buttons even when inference is not configured', async () => {
    const fixture = dbFixture(true);
    const fetchImpl = vi.fn();
    const runtime = { getMode: () => 'on_demand' as const, ensureReady: vi.fn(), release: vi.fn() };
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, runtime });
    const result = await service.chat({ consultationId, message: '不適合番号7943の対策を教えて' });
    expect(result.status).toBe('ready');
    expect(result.needsClarification).toBe(true);
    expect(result.confirmation?.prompt).toContain('7943');
    expect(result.confirmation?.options).toHaveLength(4);
    expect((await service.get(consultationId))?.messages.at(-1)?.confirmation).toEqual(result.confirmation);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(runtime.ensureReady).not.toHaveBeenCalled();
  });

  it('passes the original question and confirmed purpose to the first native Hermes turn', async () => {
    const fixture = dbFixture(true);
    const fetchImpl = vi.fn().mockImplementation(async () => new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output_text: JSON.stringify({ message: '記録の対策を確認しました。', needsClarification: false, openQuestions: [] }) } })}\n\n`));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    const first = await service.chat({ consultationId, message: '穴の裏が膨らんだ事例の対策は？' });
    const selection = { prompt: first.confirmation!.prompt, option: first.confirmation!.options![0]! };
    const answer = await service.chat({ consultationId, message: selection.option, selection });
    const payload = JSON.parse(JSON.parse(fetchImpl.mock.calls[0]![1].body).input[0].content);
    expect(payload.confirmedIntent).toEqual({ originalQuestion: '穴の裏が膨らんだ事例の対策は？', purpose: selection.option, confirmationComplete: false });
    expect(payload.questionRecipe).toMatchObject({ id: 'record-answer', version: '1', speculative: true });
    expect(payload.sourceDefinitions.map((source: { kind: string }) => source.kind)).toEqual(['nonconformity', 'work_instruction']);
    expect(payload.sourceDefinitions.find((source: { kind: string }) => source.kind === 'nonconformity')).toMatchObject({
      recordUnit: '1行 = 1件の不適合記録',
      relationKeys: [{ key: 'partNumber', target: 'work_instruction.partNumber' }]
    });
    expect(JSON.stringify(JSON.parse(fetchImpl.mock.calls[0]![1].body).instructions)).not.toContain('同じpartNumberだけ');
    expect(fixture.row.hermesConversationId).toBe(JSON.parse(fetchImpl.mock.calls[0]![1].body).conversation);
    expect(payload.caseState.openQuestions).toEqual([]);
    expect(answer.message).toBe('記録の対策を確認しました。');
    await service.chat({ consultationId, message: 'その対策をもう少し詳しく教えて' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('accepts server-resolved conditions and trusted DB facts without a duplicate native search', async () => {
    const fixture = dbFixture(true);
    const record = {
      kind: 'nonconformity', id: 'nc-grounded', evidenceKey: 'nonconformity:nc-grounded', nonconformityNo: '00008196',
      partNumber: 'MD005195722', originDepartmentCode: '110507051', originDepartmentName: '三島工場製造部機械課',
      condition: '加工不良', discoveredOn: '2026-09-04', sourceVersionDate: '2026-09-06', sourceResultCount: 1, sourceReturnedCount: 1, text: '加工不良'
    };
    const grounding = {
      resolution: {
        version: 1 as const,
        request: '三島工場の機械課の直近の不適合を2件探して',
        terms: ['三島工場', '機械課', '不適合'],
        requestedKinds: ['nonconformity' as const],
        requestedLimit: 2,
        unresolvedConditions: [],
        ambiguous: false,
        fields: [{
          kind: 'nonconformity' as const,
          field: 'originDepartmentName',
          status: 'resolved' as const,
          candidates: [{ kind: 'nonconformity' as const, field: 'originDepartmentName', value: '三島工場製造部機械課', code: '110507051', source: 'ScawStFutekigoCurrent', matchedTerms: ['三島工場', '機械課'] }],
          selected: { kind: 'nonconformity' as const, field: 'originDepartmentName', value: '三島工場製造部機械課', code: '110507051', source: 'ScawStFutekigoCurrent', matchedTerms: ['三島工場', '機械課'] }
        }]
      },
      conditions: { kind: 'nonconformity' as const, limit: 2, originDepartmentName: '三島工場製造部機械課', originDepartmentCode: '110507051' },
      result: { results: [record], total: 1, limit: 2, truncated: false, hasMore: { nonconformity: false, workInstruction: false }, nextCursor: { nonconformityOffset: null, workInstructionOffset: null } },
      evidence: [record]
    };
    const sourceResolver = { resolveAndSearch: vi.fn().mockResolvedValue(grounding) };
    const answerCache = { suggest: vi.fn().mockResolvedValue(null), candidates: vi.fn().mockResolvedValue(['候補']), answer: vi.fn() };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify({ type: 'response.completed', response: {
      status: 'completed',
      output_text: JSON.stringify({ message: '正式な起因部署の直近記録です。', needsClarification: false, recordIds: ['nonconformity:nc-grounded'], recordView: 'summary' })
    } })}\n\n`));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, sourceResolver, answerCache,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });

    const first = await service.chat({ consultationId, message: '三島工場の機械課の直近の不適合を2件探して' });
    const selection = { prompt: first.confirmation!.prompt, option: '候補' };
    const response = await service.chat({ consultationId, message: selection.option, selection });
    const payload = JSON.parse(JSON.parse(fetchImpl.mock.calls[0]![1].body).input[0].content);

    expect(sourceResolver.resolveAndSearch).toHaveBeenCalledTimes(2);
    expect(payload.sourceResolution).toMatchObject({ ambiguous: false, requestedKinds: ['nonconformity'] });
    expect(payload.groundedSearch).toMatchObject({ conditions: grounding.conditions, result: grounding.result });
    expect(response.recordIds).toEqual(['nonconformity:nc-grounded']);
    expect(response.message).toBe('不適合を1件確認しました（返却1件）。不適合番号: 00008196。発見日: 2026-09-04。選択した記録カードは概要表示です。原文は詳細表示で確認できます。');
    expect(response.evidence[0]).toMatchObject({ id: 'nc-grounded' });
    expect(response.evidence[0]?.displayFields.detail).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'nonconformityNo', value: '00008196' }),
      expect.objectContaining({ key: 'discoveredOn', value: '2026-09-04' }),
      expect.objectContaining({ key: 'sourceVersionDate', value: '2026-09-06' }),
      expect.objectContaining({ key: 'sourceResultCount', value: '1' }),
      expect.objectContaining({ key: 'sourceReturnedCount', value: '1' })
    ]));
    expect(fixture.messages[2]!.evidence).toEqual([record]);
  });

  it('shows trusted source counts, identifiers, dates, and public text in normal source cards', async () => {
    const fixture = dbFixture(true);
    const partNumber = 'MD000006698';
    const shootingTarget = '研削';
    const stepOne = { kind: 'work_instruction', id: 'step-1', evidenceKey: 'work_instruction:step-1', partNumber, shootingTarget,
      step: 1, effectiveText: 'O3030\nベッセルコマ\n段差17', sourceVersionDate: '2026-09-06', publishedVersionId: 'version-1', publishedVersionCreatedAt: '2026-09-07T01:02:03.000Z', publishedRevisionId: 'revision-1', publishedRevisionCreatedAt: '2026-09-08T04:05:06.000Z', sourceGroupCount: 1, sourceGroupCountScope: 'returned_page', sourceRowCount: 2 };
    const stepTwo = { kind: 'work_instruction', id: 'step-2', evidenceKey: 'work_instruction:step-2', partNumber, shootingTarget,
      step: 2, effectiveText: 'O3035\n確認してから作業', sourceVersionDate: '2026-09-06', publishedVersionId: 'version-2', publishedVersionCreatedAt: '2026-09-07T07:08:09.000Z', publishedRevisionId: 'revision-2', publishedRevisionCreatedAt: '2026-09-08T10:11:12.000Z', sourceGroupCount: 1, sourceGroupCountScope: 'returned_page', sourceRowCount: 2 };
    const group = { kind: 'work_instruction', id: 'group-1', partNumber, shootingTarget, public: true,
      rows: [
        { id: 'row-1', steps: [stepOne] },
        { id: 'row-2', steps: [stepTwo] }
      ] };
    const grounding = {
      resolution: {
        version: 1 as const, request: `品番${partNumber}の公開${shootingTarget}要領`, terms: [partNumber, shootingTarget, '公開', '要領'],
        requestedKinds: ['work_instruction' as const], requestedLimit: 1, unresolvedConditions: [], ambiguous: false,
        fields: [
          { kind: 'work_instruction' as const, field: 'partNumber', status: 'resolved' as const, candidates: [{ kind: 'work_instruction' as const, field: 'partNumber', value: partNumber, source: 'WorkInstructionSourcePublication', matchedTerms: [partNumber] }],
            selected: { kind: 'work_instruction' as const, field: 'partNumber', value: partNumber, source: 'WorkInstructionSourcePublication', matchedTerms: [partNumber] } },
          { kind: 'work_instruction' as const, field: 'shootingTarget', status: 'resolved' as const, candidates: [{ kind: 'work_instruction' as const, field: 'shootingTarget', value: shootingTarget, source: 'WorkInstructionSourcePublication', matchedTerms: [shootingTarget] }],
            selected: { kind: 'work_instruction' as const, field: 'shootingTarget', value: shootingTarget, source: 'WorkInstructionSourcePublication', matchedTerms: [shootingTarget] } }
        ]
      },
      conditions: { kind: 'work_instruction' as const, limit: 1, partNumber, shootingTarget },
      result: { results: [group], total: 1, limit: 1, truncated: false, hasMore: { nonconformity: false, workInstruction: false }, nextCursor: { nonconformityOffset: null, workInstructionOffset: null } },
      evidence: [stepOne, stepTwo]
    };
    const sourceResolver = { resolveAndSearch: vi.fn().mockResolvedValue(grounding) };
    const fetchImpl = vi.fn().mockImplementation(async () => new Response(`data: ${JSON.stringify({ type: 'response.completed', response: {
      status: 'completed',
      output: [
        { type: 'function_call', name: 'business_hermes_search', call_id: 'search-public', arguments: JSON.stringify(grounding.conditions) },
        { type: 'function_call_output', call_id: 'search-public', output: JSON.stringify(grounding.result) }
      ],
      output_text: JSON.stringify({ message: '公開要領を2件確認しました。', needsClarification: false, recordIds: ['work_instruction:step-2'] })
    } })}\n\n`));
    const answerCache = { suggest: vi.fn().mockResolvedValue(null), candidates: vi.fn().mockResolvedValue(['候補']), answer: vi.fn() };
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, sourceResolver, answerCache,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });

    const first = await service.chat({ consultationId, message: `品番${partNumber}の公開${shootingTarget}要領の内容を教えて` });
    const selection = { prompt: first.confirmation!.prompt, option: '候補' };
    const response = await service.chat({ consultationId, message: selection.option, selection });

    expect(response.message).toBe('公開作業要領を1グループ（返却ページ内）、2行確認しました。元データ更新日: 2026-09-06。選択した記録カードは概要表示です。原文は詳細表示で確認できます。');
    expect(response.recordIds).toEqual(['work_instruction:step-2']);
    expect(response.recordView).toBe('summary');
    expect(response.consultation.messages.at(-1)?.content).toBe(response.message);
    const cards = response.evidence.filter((entry) => entry.kind === 'work_instruction');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.displayFields?.summary).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'sourceGroupCount', value: '1' }),
      expect.objectContaining({ key: 'sourceGroupCountScope', value: '返却ページ内' }),
      expect.objectContaining({ key: 'sourceRowCount', value: '2' }),
      expect.objectContaining({ key: 'sourceVersionDate', value: '2026-09-06' })
    ]));
    expect(cards[0]?.displayFields?.detail.find((field) => field.key === 'text')?.value).toBe(stepTwo.effectiveText);
    expect(response.consultation.messages.at(-1)?.evidence.filter((entry) => entry.kind === 'work_instruction')).toHaveLength(2);

    await service.chat({ consultationId, message: '表示した手順の並びを確認して' });
    const nextPayload = JSON.parse(JSON.parse(fetchImpl.mock.calls[1]![1].body).input[0].content);
    expect(nextPayload.history.at(-1)).toMatchObject({ role: 'assistant', recordIds: ['work_instruction:step-2'] });
    expect(nextPayload.availableEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ evidenceKey: 'work_instruction:step-1', effectiveText: stepOne.effectiveText }),
      expect.objectContaining({ evidenceKey: 'work_instruction:step-2', effectiveText: stepTwo.effectiveText,
        sourceVersionDate: '2026-09-06', publishedVersionId: 'version-2', publishedVersionCreatedAt: '2026-09-07T07:08:09.000Z',
        publishedRevisionId: 'revision-2', publishedRevisionCreatedAt: '2026-09-08T10:11:12.000Z' })
    ]));
    expect(nextPayload.displayedEvidence).toEqual([
      expect.objectContaining({ evidenceKey: 'work_instruction:step-2', effectiveText: stepTwo.effectiveText })
    ]);
  });

  it('requires an official candidate confirmation before native search and display', async () => {
    const fixture = dbFixture(true);
    const officialDepartment = '三島工場製造部機械課';
    const record = {
      kind: 'nonconformity', id: 'nc-confirmed', evidenceKey: 'nonconformity:nc-confirmed', nonconformityNo: '00008196',
      partNumber: 'MD005195722', originDepartmentCode: '110507051', originDepartmentName: officialDepartment,
      condition: '加工不良', discoveredOn: '2026-09-04', sourceVersionDate: '2026-09-06', text: '加工不良'
    };
    const ambiguousResolution = {
      version: 1 as const, request: '三島工場の機械課の不適合', terms: ['三島工場', '機械課', '不適合'],
      requestedKinds: ['nonconformity' as const], requestedLimit: 2, unresolvedConditions: [], ambiguous: true,
      fields: [{ kind: 'nonconformity' as const, field: 'originDepartmentName', status: 'ambiguous' as const,
        candidates: [
          { kind: 'nonconformity' as const, field: 'originDepartmentName', value: officialDepartment, code: '110507051', source: 'ScawStFutekigoCurrent', matchedTerms: ['三島工場', '機械課'] },
          { kind: 'nonconformity' as const, field: 'originDepartmentName', value: '大阪工場製造部機械課', code: '220507051', source: 'ScawStFutekigoCurrent', matchedTerms: ['機械課'] }
        ] }]
    };
    const confirmedGrounding = {
      resolution: { ...ambiguousResolution, request: `${ambiguousResolution.request}\n${officialDepartment}`, ambiguous: false,
        fields: [{ ...ambiguousResolution.fields[0]!, status: 'resolved' as const, selected: ambiguousResolution.fields[0]!.candidates[0] }] },
      conditions: { kind: 'nonconformity' as const, limit: 2, originDepartmentName: officialDepartment, originDepartmentCode: '110507051' },
      result: { results: [record], total: 1, limit: 2, truncated: false, hasMore: { nonconformity: false, workInstruction: false }, nextCursor: { nonconformityOffset: null, workInstructionOffset: null } },
      evidence: [record]
    };
    const sourceResolver = { resolveAndSearch: vi.fn().mockImplementation(async (request: string) =>
      request.includes(officialDepartment) ? confirmedGrounding : { resolution: ambiguousResolution, conditions: null, result: null, evidence: [] }) };
    const nativeConfirmation = new Response(`data: ${JSON.stringify({ type: 'response.completed', response: {
      status: 'completed', output_text: JSON.stringify({ message: '起因部署を確認してください。', needsClarification: true,
        confirmation: { title: '起因部署の確認', prompt: 'どの正式な起因部署ですか？', options: [officialDepartment, '大阪工場製造部機械課'] } })
    } })}\n\n`);
    const nativeAnswer = new Response(`data: ${JSON.stringify({ type: 'response.completed', response: {
      status: 'completed',
      output: [
        { type: 'function_call', name: 'business_hermes_search', call_id: 'search-confirmed', arguments: JSON.stringify(confirmedGrounding.conditions) },
        { type: 'function_call_output', call_id: 'search-confirmed', output: JSON.stringify(confirmedGrounding.result) }
      ],
      output_text: JSON.stringify({ message: '正式な起因部署の記録です。', needsClarification: false, recordIds: ['nonconformity:nc-confirmed'] })
    } })}\n\n`);
    const fetchImpl = vi.fn().mockResolvedValueOnce(nativeConfirmation).mockResolvedValueOnce(nativeAnswer);
    const answerCache = { suggest: vi.fn().mockResolvedValue(null), candidates: vi.fn().mockResolvedValue(['候補']), answer: vi.fn() };
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, sourceResolver, answerCache,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });

    const first = await service.chat({ consultationId, message: '三島工場の機械課の不適合を2件探して' });
    const purposeSelection = { prompt: first.confirmation!.prompt, option: '候補' };
    const candidatePrompt = await service.chat({ consultationId, message: purposeSelection.option, selection: purposeSelection });
    const candidateSelection = { prompt: candidatePrompt.confirmation!.prompt, option: officialDepartment };
    const result = await service.chat({ consultationId, message: candidateSelection.option, selection: candidateSelection });

    expect(candidatePrompt.confirmation?.options).toEqual([officialDepartment, '大阪工場製造部機械課']);
    expect(sourceResolver.resolveAndSearch).toHaveBeenCalledTimes(3);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.recordIds).toEqual(['nonconformity:nc-confirmed']);
    expect(result.evidence[0]).toMatchObject({ id: 'nc-confirmed' });
  });

  it('does not let a confirmed candidate A authorize candidate B', async () => {
    const fixture = dbFixture(true);
    const candidateA = '三島工場製造部機械課';
    const candidateB = '大阪工場製造部機械課';
    const resolution = {
      version: 1 as const, request: '三島工場の機械課の不適合', terms: ['三島工場', '機械課', '不適合'],
      requestedKinds: ['nonconformity' as const], requestedLimit: 1, unresolvedConditions: [], ambiguous: true,
      fields: [{ kind: 'nonconformity' as const, field: 'originDepartmentName', status: 'ambiguous' as const,
        candidates: [
          { kind: 'nonconformity' as const, field: 'originDepartmentName', value: candidateA, code: 'A', source: 'ScawStFutekigoCurrent', matchedTerms: ['機械課'] },
          { kind: 'nonconformity' as const, field: 'originDepartmentName', value: candidateB, code: 'B', source: 'ScawStFutekigoCurrent', matchedTerms: ['機械課'] }
        ] }]
    };
    const confirmedGrounding = {
      resolution: { ...resolution, ambiguous: false, fields: [{ ...resolution.fields[0]!, status: 'resolved' as const, selected: resolution.fields[0]!.candidates[0] }] },
      conditions: { kind: 'nonconformity' as const, limit: 1, originDepartmentName: candidateA, originDepartmentCode: 'A' },
      result: { results: [], total: 0, limit: 1, truncated: false }, evidence: []
    };
    const sourceResolver = { resolveAndSearch: vi.fn().mockImplementation(async (request: string) => request.includes(candidateA)
      ? confirmedGrounding : { resolution, conditions: null, result: null, evidence: [] }) };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify({ type: 'response.completed', response: {
      status: 'completed',
      output: [
        { type: 'function_call', name: 'business_hermes_search', call_id: 'search-wrong-candidate', arguments: JSON.stringify({ kind: 'nonconformity', limit: 1, originDepartmentName: candidateA, originDepartmentCode: 'B' }) },
        { type: 'function_call_output', call_id: 'search-wrong-candidate', output: JSON.stringify({ results: [{ kind: 'nonconformity', id: 'nc-b', originDepartmentName: candidateB, originDepartmentCode: 'B' }], total: 1, limit: 1 }) }
      ],
      output_text: JSON.stringify({ message: '別候補の記録です。', needsClarification: false })
    } })}\n\n`));
    const answerCache = { suggest: vi.fn().mockResolvedValue(null), candidates: vi.fn().mockResolvedValue([candidateA]), answer: vi.fn() };
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, sourceResolver, answerCache,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });

    const first = await service.chat({ consultationId, message: '三島工場の機械課の不適合を1件探して' });
    const selection = { prompt: first.confirmation!.prompt, option: candidateA };
    const result = await service.chat({ consultationId, message: selection.option, selection });

    expect(result.reasonCode).toBe('HERMES_SEARCH_CONDITIONS_NOT_CONFIRMED');
    expect(fixture.messages).toHaveLength(3);
    const guardMeasurement = fixture.messages[2]!.searchDiagnostics.find((entry) => entry.kind === 'business-hermes-learning-v1') as { sourceGuardFailure?: unknown } | undefined;
    const guardFailure = guardMeasurement?.sourceGuardFailure;
    expect(guardFailure).toMatchObject({
      reasonCode: 'HERMES_SEARCH_CONDITIONS_NOT_CONFIRMED',
      expectedConditions: { kind: 'nonconformity', limit: 1, originDepartmentName: candidateA, originDepartmentCode: 'A' },
      nativeSearches: [{
        arguments: { kind: 'nonconformity', limit: 1, originDepartmentName: candidateA, originDepartmentCode: 'B' },
        queryPresent: false,
        conditionPresent: false
      }]
    });
  });

  it('does not accept a cached answer when source conditions are unresolved', async () => {
    const fixture = dbFixture(true);
    const sourceResolver = { resolveAndSearch: vi.fn().mockResolvedValue({
      resolution: {
        version: 1 as const, request: '架空工場の不適合', terms: ['架空工場'], requestedKinds: ['nonconformity' as const],
        requestedLimit: 10, unresolvedConditions: [], fields: [{
          kind: 'nonconformity' as const, field: 'originDepartmentName', status: 'ambiguous' as const,
          candidates: [{ kind: 'nonconformity' as const, field: 'originDepartmentName', value: '三島工場製造部機械課', source: 'ScawStFutekigoCurrent', matchedTerms: ['工場'] }]
        }], ambiguous: true
      },
      conditions: null, result: null, evidence: []
    }) };
    const cachedOption = `${CACHED_QUESTION_PREFIX}架空工場の不適合`;
    const answerCache = { suggest: vi.fn().mockResolvedValue(null), candidates: vi.fn().mockResolvedValue([cachedOption]), answer: vi.fn().mockResolvedValue({
      status: 'completed', output_text: JSON.stringify({ message: 'キャッシュ回答', needsClarification: false })
    }) };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify({ type: 'response.completed', response: {
      status: 'completed', output_text: JSON.stringify({ message: '未確認回答', needsClarification: false })
    } })}\n\n`));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, sourceResolver, answerCache,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });

    const first = await service.chat({ consultationId, message: '架空工場の不適合' });
    const selection = { prompt: first.confirmation!.prompt, option: cachedOption };
    const result = await service.chat({ consultationId, message: selection.option, selection });

    expect(answerCache.answer).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.reasonCode).toBeUndefined();
    expect(result.needsClarification).toBe(true);
    expect(result.confirmation?.options).toEqual(['三島工場製造部機械課']);
  });

  it('does not adopt a prepared single-source answer before native source verification', async () => {
    const fixture = dbFixture(true);
    const sourceOption = `${SOURCE_QUESTION_PREFIX}架空工場の不適合`;
    const sourceResolver = { resolveAndSearch: vi.fn().mockResolvedValue({
      resolution: {
        version: 1 as const, request: '架空工場の不適合', terms: ['架空工場'], requestedKinds: ['nonconformity' as const],
        requestedLimit: 10, unresolvedConditions: [], fields: [{
          kind: 'nonconformity' as const, field: 'originDepartmentName', status: 'ambiguous' as const,
          candidates: [{ kind: 'nonconformity' as const, field: 'originDepartmentName', value: '三島工場製造部機械課', source: 'ScawStFutekigoCurrent', matchedTerms: ['工場'] }]
        }], ambiguous: true
      },
      conditions: null, result: null, evidence: []
    }) };
    const preparedAnswer = { answer: vi.fn().mockResolvedValue({
      status: 'completed', output_text: JSON.stringify({ message: '単一資料の回答', needsClarification: false })
    }) };
    const answerCache = { suggest: vi.fn().mockResolvedValue(null), candidates: vi.fn().mockResolvedValue([sourceOption]), answer: vi.fn() };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify({ type: 'response.completed', response: {
      status: 'completed', output_text: JSON.stringify({ message: '未確認回答', needsClarification: false })
    } })}\n\n`));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, sourceResolver, answerCache, preparedAnswer,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });

    const first = await service.chat({ consultationId, message: '架空工場の不適合' });
    const selection = { prompt: first.confirmation!.prompt, option: sourceOption };
    const result = await service.chat({ consultationId, message: selection.option, selection });

    expect(preparedAnswer.answer).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.reasonCode).toBeUndefined();
    expect(result.needsClarification).toBe(true);
    expect(result.confirmation?.options).toEqual(['三島工場製造部機械課']);
  });

  it('discards the candidate for a supplement and rejects a forged first choice', async () => {
    const fixture = dbFixture(true);
    const fetchImpl = vi.fn().mockImplementation(async () => new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output_text: '{"message":"確認しました。","needsClarification":false,"openQuestions":[]}' } })}\n\n`));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    const first = await service.chat({ consultationId, message: '加工の不具合を調べたい' });
    const invalid = await service.chat({ consultationId, message: '選ぶ', selection: { prompt: first.confirmation!.prompt, option: '存在しない候補' } });
    expect(invalid.reasonCode).toBe('HERMES_INVALID_SELECTION');
    const supplement = await service.chat({ consultationId, message: '補足する', selection: { prompt: first.confirmation!.prompt, option: '自分の言葉で補足する' } });
    expect(supplement.clarificationMessage).toContain('補足');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fixture.row.hermesConversationId).toBe('hermes-conversation-1');
    await service.chat({ consultationId, message: '不適合番号7943の再発防止策です' });
    const payload = JSON.parse(JSON.parse(fetchImpl.mock.calls[1]![1].body).input[0].content);
    expect(payload.confirmedIntent).toEqual({ originalQuestion: '加工の不具合を調べたい', purpose: '不適合番号7943の再発防止策です', confirmationComplete: true });
  });

  function completedResponse(message = '確認済みの回答') {
    return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: {
      status: 'completed', output_text: JSON.stringify({ message, needsClarification: false })
    } })}\n\n`);
  }

  it('starts before choice, joins unfinished inference once, and adopts its session only after validation', async () => {
    const fixture = dbFixture(true);
    let complete!: (response: Response) => void;
    const fetchImpl = vi.fn((_url: URL, options: RequestInit) => new Promise<Response>((resolve, reject) => {
      complete = resolve;
      options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    const first = await service.chat({ consultationId, message: '不適合番号7943の再発防止策は？' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(first.confirmation?.options?.[0]).toContain('7943');
    expect(fixture.messages).toHaveLength(2);
    expect(fixture.row.hermesConversationId).toBe('hermes-conversation-1');
    const selection = { prompt: first.confirmation!.prompt, option: first.confirmation!.options![0]! };
    const answer = service.chat({ consultationId, message: selection.option, selection });
    await vi.waitFor(() => expect(fixture.messages).toHaveLength(3));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    complete(completedResponse());
    expect((await answer).message).toBe('確認済みの回答');
    expect(fixture.messages).toHaveLength(4);
    expect(fixture.row.hermesConversationId).toBe(JSON.parse(fetchImpl.mock.calls[0]![1].body as string).conversation);
  });

  it('aborts an unmatched candidate and uses a separate confirmed session', async () => {
    const fixture = dbFixture(true);
    let speculativeSignal!: AbortSignal;
    const fetchImpl = vi.fn().mockImplementationOnce((_url: URL, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      speculativeSignal = options.signal!;
      speculativeSignal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    })).mockImplementation(async () => completedResponse('選ばれた原因の回答'));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    const first = await service.chat({ consultationId, message: '穴加工について' });
    const selection = { prompt: first.confirmation!.prompt, option: first.confirmation!.options![1]! };
    const answer = await service.chat({ consultationId, message: selection.option, selection });
    expect(speculativeSignal.aborted).toBe(true);
    expect(answer.message).toBe('選ばれた原因の回答');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const selectedBody = JSON.parse(fetchImpl.mock.calls[1]![1].body);
    expect(selectedBody.conversation).toBe('hermes-conversation-1');
    expect(JSON.parse(selectedBody.input[0].content).questionRecipe).toMatchObject({ id: 'record-cause', speculative: false });
  });

  it('expires an unselected completed answer and performs fresh inference', async () => {
    vi.useFakeTimers();
    const fixture = dbFixture(true);
    const fetchImpl = vi.fn().mockImplementation(async () => completedResponse());
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    const first = await service.chat({ consultationId, message: '番号7943について' });
    await vi.advanceTimersByTimeAsync(30_001);
    expect(fixture.messages).toHaveLength(2);
    const selection = { prompt: first.confirmation!.prompt, option: first.confirmation!.options![0]! };
    expect((await service.chat({ consultationId, message: selection.option, selection })).status).toBe('ready');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fixture.row.hermesConversationId).toBe('hermes-conversation-1');
  });

  it('cancels background readiness without persisting a speculative answer and releases its late lease', async () => {
    const fixture = dbFixture(true);
    let ready!: () => void;
    const runtime = { getMode: () => 'on_demand' as const, ensureReady: vi.fn(() => new Promise<void>((resolve) => { ready = resolve; })), release: vi.fn().mockResolvedValue(undefined) };
    const fetchImpl = vi.fn();
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, runtime,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat', provider: 'dgx' } });
    const first = await service.chat({ consultationId, message: '確認したい' });
    expect(first.confirmation).toBeDefined();
    expect(runtime.ensureReady).toHaveBeenCalledTimes(1);
    expect(await service.cancel(consultationId)).toBe(true);
    ready();
    await vi.waitFor(() => expect(runtime.release).toHaveBeenCalledTimes(1));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fixture.messages).toHaveLength(2);
  });

  it('falls back after speculative failure without preventing a choice', async () => {
    const fixture = dbFixture(true);
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(async () => completedResponse());
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    const first = await service.chat({ consultationId, message: '番号7943について' });
    const selection = { prompt: first.confirmation!.prompt, option: first.confirmation!.options![0]! };
    expect((await service.chat({ consultationId, message: selection.option, selection })).status).toBe('ready');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not adopt a precomputed answer that fails existing evidence validation', async () => {
    const fixture = dbFixture(true);
    const fetchImpl = vi.fn().mockImplementation(async () => new Response(`data: ${JSON.stringify({ type: 'response.completed', response: {
      status: 'completed', output_text: JSON.stringify({ message: '未検証', needsClarification: false, recordIds: ['nonconformity:foreign'] })
    } })}\n\n`));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    const first = await service.chat({ consultationId, message: '記録を見たい' });
    const selection = { prompt: first.confirmation!.prompt, option: first.confirmation!.options![0]! };
    expect((await service.chat({ consultationId, message: selection.option, selection })).reasonCode).toBe('HERMES_RECORD_NOT_AVAILABLE');
    expect(fixture.row.hermesConversationId).toBe('hermes-conversation-1');
    expect(fixture.messages).toHaveLength(3);
  });

  it('bounds a joined prefetch and fallback by one foreground deadline', async () => {
    vi.useFakeTimers();
    const fixture = dbFixture(true);
    const fetchImpl = vi.fn((_url: URL, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat', timeoutMs: 500 } });
    const first = await service.chat({ consultationId, message: '調べてください' });
    await vi.advanceTimersByTimeAsync(100);
    const selection = { prompt: first.confirmation!.prompt, option: first.confirmation!.options![0]! };
    const selected = service.chat({ consultationId, message: selection.option, selection });
    await vi.advanceTimersByTimeAsync(501);
    expect((await selected).reasonCode).toBe('HERMES_TIMEOUT');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.every((call) => call[1].signal?.aborted)).toBe(true);
    expect(fixture.messages).toHaveLength(3);
  });

  it('does not start a second unselected candidate in another consultation', async () => {
    const firstFixture = dbFixture(true);
    const secondFixture = dbFixture(true);
    const otherId = '00000000-0000-0000-0000-000000000011';
    secondFixture.row.id = otherId;
    const fetchImpl = vi.fn().mockImplementation(async () => completedResponse());
    const config = { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' };
    const firstService = new BusinessHermesConsultationService({ db: firstFixture.db as never, fetchImpl, config });
    const secondService = new BusinessHermesConsultationService({ db: secondFixture.db as never, fetchImpl, config });
    await firstService.chat({ consultationId, message: '最初の相談' });
    const second = await secondService.chat({ consultationId: otherId, message: '別の相談' });
    expect(second.confirmation).toBeDefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const selection = { prompt: second.confirmation!.prompt, option: second.confirmation!.options![0]! };
    expect((await secondService.chat({ consultationId: otherId, message: selection.option, selection })).status).toBe('ready');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(secondFixture.row.hermesConversationId).toBe('hermes-conversation-1');
  });

  it('invalidates a candidate when the consultation state changes', async () => {
    const fixture = dbFixture(true);
    const fetchImpl = vi.fn().mockImplementation(async () => completedResponse());
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    const first = await service.chat({ consultationId, message: '元の相談' });
    fixture.row.summary = '別の端末から対象を訂正';
    const selection = { prompt: first.confirmation!.prompt, option: first.confirmation!.options![0]! };
    expect((await service.chat({ consultationId, message: selection.option, selection })).status).toBe('ready');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fixture.row.hermesConversationId).toBe('hermes-conversation-1');
  });

  it('projects trusted asset ids and ignores model supplied URLs', () => {
    const cards = projectTrustedEvidence([{
      kind: 'work_instruction', id: 'step-1', partNumber: 'PN-1', shootingTarget: '切削', text: '公開本文', sourceVersionDate: '2026-09-01T00:00:00.000Z', publishedVersionId: 'version-1', publishedVersionCreatedAt: '2026-09-02T00:00:00.000Z', publishedRevisionId: 'revision-1', publishedRevisionCreatedAt: '2026-09-03T00:00:00.000Z', asset_id: 'asset-1', photo_url: 'https://model.invalid/fake.jpg'
    }], new Set(['asset-1']));
    expect(cards[0]).toMatchObject({ imageAssetId: 'asset-1', imageUrl: '/api/work-instructions/assets/asset-1', rawImageLabel: '元写真（公開作業要領）', sourceUrl: '/kiosk/part-measurement/self-inspection?partNumber=PN-1&shootingTarget=%E5%88%87%E5%89%8A', sourceVersionDate: '2026-09-01T00:00:00.000Z', publishedVersionId: 'version-1', publishedVersionCreatedAt: '2026-09-02T00:00:00.000Z', publishedRevisionId: 'revision-1', publishedRevisionCreatedAt: '2026-09-03T00:00:00.000Z' });
    expect(cards[0]).not.toHaveProperty('photo_url');
    expect(cards[0]?.imageUrl).not.toContain('model.invalid');
  });

  it('keeps nonconformity evidence when condition is absent but a disposition is present', () => {
    const cards = projectTrustedEvidence([{
      kind: 'nonconformity', id: 'nc-1', partNumber: 'PN-1', condition: null,
      remarks: '漏れを確認', correctiveContent: 'シールを交換', disposition: '再検査'
    }], new Set());
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: 'nonconformity', id: 'nc-1', text: '漏れを確認' });
  });

  it('keeps full source values in detail fields while marking shortened summary values', () => {
    const condition = '寸法の不適合内容。'.repeat(180);
    const instructionText = '公開作業要領の全文。'.repeat(220);
    const cards = projectTrustedEvidence([
      { kind: 'nonconformity', id: 'nc-long', partNumber: 'PN-LONG', condition },
      { kind: 'work_instruction', id: 'wi-long', partNumber: 'PN-LONG', step: 1, effectiveText: instructionText }
    ], new Set());
    const nonconformity = cards.find((card) => card.id === 'nc-long');
    const workInstruction = cards.find((card) => card.id === 'wi-long');
    const summaryCondition = nonconformity?.displayFields?.summary.find((field) => field.key === 'condition');
    const detailCondition = nonconformity?.displayFields?.detail.find((field) => field.key === 'condition');
    const detailText = workInstruction?.displayFields?.detail.filter((field) => field.key === 'text');

    expect(summaryCondition?.value).toMatch(/…$/u);
    expect(detailCondition?.value).toBe(condition);
    expect(detailText).toHaveLength(1);
    expect(detailText?.[0]?.value).toBe(instructionText);
  });

  it('uses the official Responses envelope, session key, runtime lease, and persists case-scoped history', async () => {
    const fixture = dbFixture();
    const fetchImpl = vi.fn().mockResolvedValue(new Response([
      `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [
        { type: 'function_call', name: 'mcp__business_api__business_hermes_search', call_id: 'call-business-search', arguments: '{"query":"本文"}' },
        { type: 'function_call_output', call_id: 'call-business-search', output: '<untrusted_tool_result source="business_api">\nExplanation from tool\n\n{"result":"{\\"evidence\\":[{\\"kind\\":\\"work_instruction\\",\\"id\\":\\"step-1\\",\\"partNumber\\":\\"PN-1\\",\\"text\\":\\"公開本文\\",\\"asset_id\\":\\"asset-1\\",\\"photo_url\\":\\"https://model.invalid/fake.jpg\\"}]}"}\n</untrusted_tool_result>' },
        { type: 'function_call', name: 'skill_view', call_id: 'call-skill-view', arguments: '{"name":"business-consultation"}' },
        { type: 'function_call_output', call_id: 'call-skill-view', output: '{"kind":"work_instruction","id":"skill-fake","partNumber":"PN-FAKE","text":"skill text"}' },
        { type: 'message', content: [{ type: 'output_text', text: '{"message":"次に確認してください。","title":"本文確認","relatedIdentifiers":[],"confirmedFacts":[],"openQuestions":[],"summary":"本文を確認","showEvidence":true,"evidenceIds":["work_instruction:step-1"],"confirmation":null}' }] }
      ] } })}\n\n`
    ].join(''), { headers: { 'content-type': 'text/event-stream' } }));
    const runtime = { ensureReady: vi.fn().mockResolvedValue(undefined), release: vi.fn().mockResolvedValue(undefined), getMode: vi.fn().mockReturnValue('always_on') };
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, runtime, config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'business-hermes-chat', provider: 'dgx', timeoutMs: 5_000 } });
    const result = await service.chat({ consultationId, message: '本文を確認してください' });
    expect(result.status).toBe('ready');
    expect(result.evidenceVisible).toBe(true);
    expect(result.evidence[0]).toMatchObject({ imageAssetId: 'asset-1', imageUrl: '/api/work-instructions/assets/asset-1' });
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      headers: expect.objectContaining({ 'X-Hermes-Session-Key': 'hermes-conversation-1' }),
      body: expect.stringContaining('出力から省略した案件状態はサーバーの既存値を保持し')
    }));
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body)).toMatchObject({ conversation: 'hermes-conversation-1', store: true });
    expect(runtime.ensureReady).toHaveBeenCalledWith('business_hermes');
    expect(runtime.release).toHaveBeenCalledWith('business_hermes');
    expect(fixture.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
  });

  it('retains trusted evidence for a normal answer while hiding cards on consultation reopen', async () => {
    const fixture = dbFixture();
    const evidence = { kind: 'nonconformity', id: 'nc-normal', partNumber: '', text: '寸法が規格外' };
    const fetchImpl = vi.fn().mockResolvedValue(new Response([
      `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [
        { type: 'function_call', name: 'mcp__business_api__business_hermes_search', call_id: 'normal-search', arguments: '{"query":"状態"}' },
        { type: 'function_call_output', call_id: 'normal-search', output: JSON.stringify({ results: [evidence] }) },
        { type: 'message', content: [{ type: 'output_text', text: '{"message":"寸法の状態を確認しました。","title":"状態確認","relatedIdentifiers":[],"confirmedFacts":[],"openQuestions":[],"summary":"状態を確認","showEvidence":false,"confirmation":null}' }] }
      ] } })}\n\n`
    ].join(''), { headers: { 'content-type': 'text/event-stream' } }));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });

    const result = await service.chat({ consultationId, message: '状態を確認してください' });

    expect(result.evidence).toEqual([expect.objectContaining(evidence)]);
    expect(result.evidenceVisible).toBe(false);
    expect(fixture.messages.at(-1)?.evidence).toEqual({ items: result.evidence, visible: false, visibleIds: [], recordIds: [] });
    expect(result.consultation.messages.at(-1)).toMatchObject({ evidence: result.evidence, evidenceVisible: false });
    expect((await service.get(consultationId))?.messages.at(-1)).toMatchObject({ evidence: result.evidence, evidenceVisible: false });
  });

  it('does not save or present a successful answer when evidence display has no valid ids', async () => {
    const fixture = dbFixture();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [
      { type: 'function_call', name: 'mcp__business_api__business_hermes_search', call_id: 'photo-search-no-id' },
      { type: 'function_call_output', call_id: 'photo-search-no-id', output: JSON.stringify({ results: [{ kind: 'work_instruction', id: 'wi-1', partNumber: 'PN-1', text: '公開手順', asset_id: 'asset-1' }] }) },
      { type: 'message', content: [{ type: 'output_text', text: '{"message":"写真を表示しました。","title":"写真確認","relatedIdentifiers":[],"confirmedFacts":[],"openQuestions":[],"summary":"写真確認","showEvidence":true,"needsClarification":false,"confirmation":null}' }] }
    ] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } }));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });

    const result = await service.chat({ consultationId, message: '写真を見せてください' });

    expect(result).toMatchObject({
      status: 'unavailable',
      reasonCode: 'HERMES_EVIDENCE_NOT_AVAILABLE',
      message: '写真・資料を表示できませんでした。もう一度お試しください。',
      evidence: []
    });
    expect(fixture.messages.map((message) => message.role)).toEqual(['user']);
    expect(fixture.db.businessHermesConsultation.update).not.toHaveBeenCalled();
  });

  it('keeps all trusted current evidence while displaying only the explicitly selected id', async () => {
    const fixture = dbFixture();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [
      { type: 'function_call', name: 'mcp__business_api__business_hermes_search', call_id: 'candidate-search', arguments: '{}' },
      { type: 'function_call_output', call_id: 'candidate-search', output: JSON.stringify({ results: [
        { kind: 'nonconformity', id: 'nc-1', nonconformityNo: 'NC-1', remarks: '寸法差', partNumber: null },
        { kind: 'nonconformity', id: 'nc-2', nonconformityNo: 'NC-2', remarks: '傷', partNumber: null }
      ] }) },
        { type: 'message', content: [{ type: 'output_text', text: '{"message":"NC-1の根拠を表示します。","title":"根拠確認","relatedIdentifiers":[],"confirmedFacts":[],"openQuestions":[],"summary":"根拠確認","showEvidence":true,"evidenceIds":["nonconformity:nc-1","nonconformity:foreign-case","work_instruction:missing"],"recordIds":["nonconformity:nc-2"],"recordView":"summary","needsClarification":false,"confirmation":null}' }] }
    ] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } }));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });

    const result = await service.chat({ consultationId, message: 'NC-1の根拠を見せてください' });

    expect(result.evidence.map((item) => item.id)).toEqual(['nc-1', 'nc-2']);
    expect(result.evidenceVisibleIds).toEqual(['nonconformity:nc-1']);
    expect(fixture.messages.at(-1)?.evidence).toMatchObject({
      items: [expect.objectContaining({ id: 'nc-1' }), expect.objectContaining({ id: 'nc-2' })],
      visible: true,
      visibleIds: ['nonconformity:nc-1'],
      recordIds: ['nonconformity:nc-2'],
      recordView: 'summary'
    });
    expect(result.consultation.messages.at(-1)).toMatchObject({
      evidence: [expect.objectContaining({ id: 'nc-1' }), expect.objectContaining({ id: 'nc-2' })],
      evidenceVisible: true,
      evidenceVisibleIds: ['nonconformity:nc-1'],
      recordIds: ['nonconformity:nc-2'],
      recordView: 'summary'
    });
  });

  it('projects selected records into summary/detail fields and persists the display choice', async () => {
    const fixture = dbFixture();
    const record = {
      kind: 'nonconformity', id: 'nc-record', nonconformityNo: 'NC-42', partNumber: 'PN-42',
      partName: 'ブラケット', machineName: '検査機', discoveredOn: '2026-09-01', condition: '寸法差',
      originDepartmentName: '機械課', remarks: '備考', disposition: '再検査', correctiveContent: '交換'
    };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [
      { type: 'function_call', name: 'mcp__business_api__business_hermes_search', call_id: 'record-search', arguments: '{}' },
      { type: 'function_call_output', call_id: 'record-search', output: JSON.stringify({ results: [record] }) },
      { type: 'message', content: [{ type: 'output_text', text: '{"message":"記録を表示します。","recordIds":["nonconformity:nc-record"],"recordView":"detail","needsClarification":false}' }] }
    ] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } }));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });

    const result = await service.chat({ consultationId, message: '記録を見せてください' });

    expect(result.recordIds).toEqual(['nonconformity:nc-record']);
    expect(result.recordView).toBe('detail');
    expect(result.evidence[0]?.displayFields).toEqual({
      summary: expect.arrayContaining([
        { key: 'nonconformityNo', label: '不適合番号', value: 'NC-42' },
        { key: 'condition', label: '不適合内容', value: '寸法差' }
      ]),
      detail: expect.arrayContaining([{ key: 'correctiveContent', label: '個別是正', value: '交換' }])
    });
    expect(fixture.messages.at(-1)?.evidence).toMatchObject({ recordIds: ['nonconformity:nc-record'], recordView: 'detail' });
    expect((await service.get(consultationId))?.messages.at(-1)).toMatchObject({ recordIds: ['nonconformity:nc-record'], recordView: 'detail' });
  });

  it('reuses a stored record for a later explicit display request', async () => {
    const fixture = dbFixture();
    const record = {
      kind: 'nonconformity', id: 'nc-stored', nonconformityNo: 'NC-43', partNumber: 'PN-43',
      discoveredOn: '2026-09-02', condition: 'キズ'
    };
    const response = (text: string) => new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [
      { type: 'message', content: [{ type: 'output_text', text }] }
    ] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [
        { type: 'function_call', name: 'mcp__business_api__business_hermes_search', call_id: 'stored-record-search', arguments: '{}' },
        { type: 'function_call_output', call_id: 'stored-record-search', output: JSON.stringify({ results: [record] }) },
        { type: 'message', content: [{ type: 'output_text', text: '{"message":"記録を確認しました。","needsClarification":false}' }] }
      ] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } }))
      .mockResolvedValueOnce(response('{"message":"記録を表示します。","recordIds":["nonconformity:nc-stored"],"recordView":"summary","needsClarification":false}'));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });

    await service.chat({ consultationId, message: '記録を確認してください' });
    const shown = await service.chat({ consultationId, message: 'その記録を表示してください' });

    expect(shown.recordIds).toEqual(['nonconformity:nc-stored']);
    expect(shown.evidence).toEqual([expect.objectContaining({ id: 'nc-stored', displayFields: expect.objectContaining({
      summary: expect.arrayContaining([{ key: 'condition', label: '不適合内容', value: 'キズ' }])
    }) })]);
    expect(fixture.messages.at(-1)?.evidence).toMatchObject({
      recordIds: ['nonconformity:nc-stored'],
      items: [expect.objectContaining({ id: 'nc-stored' })]
    });
    expect((await service.get(consultationId))?.messages.at(-1)).toMatchObject({
      recordIds: ['nonconformity:nc-stored'],
      evidence: [expect.objectContaining({ id: 'nc-stored' })]
    });
  });

  it('rejects unknown, mixed, and malformed record ids without saving the model answer', async () => {
    const cases = [
      '["nonconformity:foreign"]',
      '["nonconformity:nc-record","nonconformity:foreign"]',
      '"nonconformity:nc-record"'
    ];
    for (const recordIds of cases) {
      const fixture = dbFixture();
      const fetchImpl = vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [
        { type: 'function_call', name: 'mcp__business_api__business_hermes_search', call_id: 'record-search', arguments: '{}' },
        { type: 'function_call_output', call_id: 'record-search', output: JSON.stringify({ results: [{ kind: 'nonconformity', id: 'nc-record', partNumber: 'PN-42', condition: '寸法差' }] }) },
        { type: 'message', content: [{ type: 'output_text', text: `{"message":"記録を表示しました。","recordIds":${recordIds},"recordView":"summary","needsClarification":false}` }] }
      ] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } }));
      const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });

      const result = await service.chat({ consultationId, message: '記録を表示してください' });

      expect(result).toMatchObject({ status: 'unavailable', reasonCode: 'HERMES_RECORD_NOT_AVAILABLE', message: '記録を表示できませんでした。もう一度お試しください。' });
      expect(fixture.messages.map((message) => message.role)).toEqual(['user']);
      expect(fixture.db.businessHermesConsultation.update).not.toHaveBeenCalled();
    }
  });

  it('revalidates a stored work-instruction photo before displaying it on a later turn', async () => {
    const fixture = dbFixture();
    const first = { kind: 'work_instruction', id: 'wi-1', partNumber: 'PN-1', text: '公開手順', asset_id: 'asset-1' };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [
        { type: 'function_call', name: 'mcp__business_api__business_hermes_search', call_id: 'wi-search', arguments: '{}' },
        { type: 'function_call_output', call_id: 'wi-search', output: JSON.stringify({ results: [first] }) },
        { type: 'message', content: [{ type: 'output_text', text: '{"message":"公開要領を確認しました。","title":"要領確認","relatedIdentifiers":[],"confirmedFacts":[],"openQuestions":[],"summary":"要領確認","showEvidence":false,"evidenceIds":[],"needsClarification":false,"confirmation":null}' }] }
      ] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } }))
      .mockResolvedValueOnce(new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [
        { type: 'message', content: [{ type: 'output_text', text: '{"message":"公開要領の写真を表示します。","title":"写真確認","relatedIdentifiers":[],"confirmedFacts":[],"openQuestions":[],"summary":"写真確認","showEvidence":true,"evidenceIds":["work_instruction:wi-1"],"needsClarification":false,"confirmation":null}' }] }
      ] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } }));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });

    const hidden = await service.chat({ consultationId, message: '公開要領を確認してください' });
    const shown = await service.chat({ consultationId, message: 'その写真を見せてください' });

    expect(hidden.evidenceVisible).toBe(false);
    expect(shown.evidence).toEqual([expect.objectContaining({ id: 'wi-1', imageAssetId: 'asset-1', imageUrl: '/api/work-instructions/assets/asset-1' })]);
    expect(shown.evidenceVisibleIds).toEqual(['work_instruction:wi-1']);
    expect(shown.consultation.messages.at(-1)).toMatchObject({ evidenceVisible: true, evidenceVisibleIds: ['work_instruction:wi-1'] });
  });

  it('does not reuse a stored photo when its asset is no longer active', async () => {
    const fixture = dbFixture();
    const activeLookup = vi.fn()
      .mockResolvedValueOnce([{ id: 'asset-2', mimeType: 'image/jpeg' }])
      .mockResolvedValueOnce([]);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [
        { type: 'function_call', name: 'mcp__business_api__business_hermes_search', call_id: 'photo-search', arguments: '{}' },
        { type: 'function_call_output', call_id: 'photo-search', output: JSON.stringify({ results: [{ kind: 'work_instruction', id: 'wi-inactive', partNumber: 'PN-2', text: '手順', asset_id: 'asset-2' }] }) },
        { type: 'message', content: [{ type: 'output_text', text: '{"message":"確認しました。","title":"確認","relatedIdentifiers":[],"confirmedFacts":[],"openQuestions":[],"summary":"確認","showEvidence":false,"evidenceIds":[],"needsClarification":false,"confirmation":null}' }] }
      ] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } }))
      .mockResolvedValueOnce(new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [
        { type: 'message', content: [{ type: 'output_text', text: '{"message":"写真を表示します。","title":"写真","relatedIdentifiers":[],"confirmedFacts":[],"openQuestions":[],"summary":"写真","showEvidence":true,"evidenceIds":["work_instruction:wi-inactive"],"needsClarification":false,"confirmation":null}' }] }
      ] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } }));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, activeAssetLookup: activeLookup,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });

    await service.chat({ consultationId, message: '手順を確認してください' });
    const shown = await service.chat({ consultationId, message: '写真を見せてください' });

    expect(shown.evidence).toEqual([expect.objectContaining({ kind: 'work_instruction', id: 'wi-inactive' })]);
    expect(shown.evidence[0]).not.toHaveProperty('imageUrl');
    expect(activeLookup).toHaveBeenNthCalledWith(2, ['asset-2']);
  });

  it('acquires the consultation DGX lease when the independent guide uses OpenAI', async () => {
    const previous = { BUSINESS_HERMES_PROVIDER: env.BUSINESS_HERMES_PROVIDER,
      BUSINESS_HERMES_CHAT_BASE_URL: env.BUSINESS_HERMES_CHAT_BASE_URL,
      BUSINESS_HERMES_CHAT_API_KEY: env.BUSINESS_HERMES_CHAT_API_KEY,
      BUSINESS_HERMES_CHAT_MODEL: env.BUSINESS_HERMES_CHAT_MODEL };
    Object.assign(env, { BUSINESS_HERMES_PROVIDER: 'openai', BUSINESS_HERMES_CHAT_BASE_URL: 'http://hermes.local',
      BUSINESS_HERMES_CHAT_API_KEY: 'test-key', BUSINESS_HERMES_CHAT_MODEL: 'chat' });
    try {
      const runtime = { ensureReady: vi.fn().mockResolvedValue(undefined), release: vi.fn().mockResolvedValue(undefined) };
      const fetchImpl = vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify({type: 'response.completed', response: {status: 'completed', output: [
        {type: 'message', content: [{type: 'output_text', text: '確認しました。'}]}
      ]}})}\n\n`));
      const service = new BusinessHermesConsultationService({ db: dbFixture().db as never, runtime, fetchImpl });
      expect((await service.chat({consultationId, message: '確認したい'})).status).toBe('ready');
      expect(runtime.ensureReady).toHaveBeenCalledWith('business_hermes');
      expect(runtime.release).toHaveBeenCalledWith('business_hermes');
    } finally { Object.assign(env, previous); }
  });

  it('keeps legacy consultation evidence available without reviving automatic card display', async () => {
    const fixture = dbFixture(true);
    fixture.messages.push({
      id: 'legacy-assistant',
      role: 'assistant',
      content: '以前の回答',
      evidence: [{ kind: 'nonconformity', id: 'legacy-nc', title: '00008195', text: '備考' }],
      createdAt: new Date()
    });
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    const detail = await service.get(consultationId);
    expect(detail?.messages).toEqual([expect.objectContaining({
      content: '以前の回答',
      evidence: [{ kind: 'nonconformity', id: 'legacy-nc', title: '00008195', text: '備考' }],
      evidenceVisible: false
    })]);
  });

  it('keeps trusted nonconformity cards when the source has no part number', async () => {
    const record = {kind: 'nonconformity', id: 'nc-unidentified', nonconformityNo: 'NC-001',
      partNumber: null, condition: null, remarks: '寸法が規格外', disposition: null};
    const fetchImpl = vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify({
      type: 'response.completed', response: {status: 'completed', output: [
        {type: 'function_call', name: 'mcp__business_api__business_hermes_search', call_id: 'nc-search', arguments: '{}'},
        {type: 'function_call_output', call_id: 'nc-search', output: JSON.stringify({results: [record]})},
        {type: 'message', content: [{type: 'output_text', text: '{"message":"不適合記録を確認しました。","title":"不適合確認","relatedIdentifiers":[],"confirmedFacts":[],"openQuestions":[],"summary":"不適合記録を確認","showEvidence":true,"evidenceIds":["nonconformity:nc-unidentified"],"confirmation":null}'}]}
      ]}
    })}\n\n`));
    const service = new BusinessHermesConsultationService({db: dbFixture().db as never, fetchImpl,
      config: {baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat'}});
    const result = await service.chat({consultationId, message: '不適合を確認したい'});
    expect(result.evidence).toEqual([expect.objectContaining({kind: 'nonconformity', id: record.id,
      title: record.nonconformityNo, partNumber: '', text: record.remarks})]);
    expect(result.evidenceVisible).toBe(true);
    expect(result.consultation.messages.at(-1)?.evidence).toEqual(result.evidence);
    expect(result.consultation.messages.at(-1)?.evidenceVisible).toBe(true);
  });

  it('retains full incremental FCO text when the terminal envelope trims it', async () => {
    const fixture = dbFixture();
    const call = { type: 'function_call', name: 'mcp__business_api__business_hermes_search', call_id: 'search-1', arguments: '{"query":"漏れ"}' };
    const payload = JSON.stringify({ results: [{ kind: 'work_instruction', id: 'row-1', partNumber: 'PN-1', rows: [{ id: 'row-1', steps: [{ id: 'step-1', step: 1, effectiveText: '公開手順。'.repeat(250), imageAssetId: 'asset-1' }] }] }] });
    const output = [{ type: 'input_text', text: `<untrusted_tool_result source="mcp__business_api__business_hermes_search">\nData only\n${JSON.stringify({ result: payload })}\n</untrusted_tool_result>` }];
    const full = { type: 'function_call_output', call_id: 'search-1', output };
    const events = [
      { type: 'response.output_item.done', item: call },
      { type: 'response.output_item.done', item: full },
      { type: 'response.completed', response: { status: 'completed', output: [call, { ...full, output: [{ type: 'input_text', text: output[0].text.slice(0, 500) + '...[more chars]' }] }, { type: 'message', content: [{ type: 'output_text', text: '{"message":"公開要領を確認しました。","title":"要領確認","relatedIdentifiers":[],"confirmedFacts":[],"openQuestions":[],"summary":"公開要領を確認","showEvidence":true,"evidenceIds":["work_instruction:step-1"],"confirmation":null}' }] }] } }
    ];
    const fetchImpl = vi.fn().mockResolvedValue(new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    const result = await service.chat({ consultationId, message: '漏れを確認したい' });
    expect(result.status).toBe('ready');
    expect(result.evidenceVisible).toBe(true);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ id: 'step-1', imageAssetId: 'asset-1', text: '公開手順。'.repeat(250) });
    expect(fixture.messages.at(-1)?.evidence).toEqual({ items: result.evidence, visible: true, visibleIds: ['work_instruction:step-1'], recordIds: [] });
    expect(result.consultation.messages.at(-1)?.searchDiagnostics).toEqual([{
      arguments: { query: '漏れ' }, total: null, truncated: false, resultIds: ['row-1']
    }]);
  });

  it('does not treat a text-done event as a completed investigation after disconnect', async () => {
    const fixture = dbFixture();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify({ type: 'response.output_text.done', text: '途中の回答' })}\n\n`));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    const result = await service.chat({ consultationId, message: '確認したい' });
    expect(result.reasonCode).toBe('HERMES_INCOMPLETE');
    expect(fixture.messages.map((message) => message.role)).toEqual(['user']);
  });

  it('preserves the previous derived summary when a response omits canonical state', async () => {
    const fixture = dbFixture();
    fixture.row.summary = '前回の引継ぎ要約';
    const fetchImpl = vi.fn().mockResolvedValue(new Response([
      `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output_text: '本文だけの回答' } })}\n\n`
    ].join(''), { headers: { 'content-type': 'text/event-stream' } }));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat', timeoutMs: 5_000 } });
    const result = await service.chat({ consultationId, message: '続き' });
    expect(result.consultation.summary).toBe('前回の引継ぎ要約');
  });

  it('preserves omitted case state instead of deriving identifiers from evidence', async () => {
    const fixture = dbFixture();
    fixture.row.title = '既存相談';
    fixture.row.relatedIdentifiers = ['PN-OLD'];
    fixture.row.confirmedFacts = ['既知の確認事項'];
    fixture.row.summary = '既存の引継ぎ';
    const fetchImpl = vi.fn().mockResolvedValue(new Response([
      `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [
        { type: 'function_call', name: 'mcp__business_api__business_hermes_search', call_id: 'omitted-state-search', arguments: '{}' },
        { type: 'function_call_output', call_id: 'omitted-state-search', output: JSON.stringify({ results: [{ kind: 'nonconformity', id: 'nc-new', partNumber: 'PN-NEW', remarks: '新しい確認事項' }] }) },
        { type: 'message', content: [{ type: 'output_text', text: '{"message":"確認しました。","needsClarification":false}' }] }
      ] } })}\n\n`
    ].join(''), { headers: { 'content-type': 'text/event-stream' } }));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat', timeoutMs: 5_000 } });

    const result = await service.chat({ consultationId, message: '続き' });

    expect(result.consultation).toMatchObject({
      title: '既存相談',
      relatedIdentifiers: ['PN-OLD'],
      confirmedFacts: ['既知の確認事項'],
      summary: '既存の引継ぎ'
    });
  });

  it('allows explicit empty state values to clear the previous case state', async () => {
    const fixture = dbFixture();
    fixture.row.title = '既存相談';
    fixture.row.relatedIdentifiers = ['PN-OLD'];
    fixture.row.confirmedFacts = ['既知の確認事項'];
    fixture.row.openQuestions = ['未解決事項'];
    fixture.row.summary = '既存の引継ぎ';
    const fetchImpl = vi.fn().mockResolvedValue(new Response([
      `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output_text: '{"message":"前提を訂正しました。","title":"訂正後の相談","relatedIdentifiers":[],"confirmedFacts":[],"openQuestions":[],"summary":"","needsClarification":false}' } })}\n\n`
    ].join(''), { headers: { 'content-type': 'text/event-stream' } }));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat', timeoutMs: 5_000 } });

    const result = await service.chat({ consultationId, message: '前提を訂正します' });

    expect(result.consultation).toMatchObject({
      title: '訂正後の相談',
      relatedIdentifiers: [],
      confirmedFacts: [],
      openQuestions: [],
      summary: ''
    });
  });

  it('keeps structured case state from a message item and gives inherited steps distinct evidence ids', async () => {
    const fixture = dbFixture();
    const fetchImpl = vi.fn().mockResolvedValue(new Response([
      `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [
        { type: 'function_call', name: 'tool_call', call_id: 'call-business-detail', arguments: '{"name":"mcp__business_api__business_hermes_get_detail","arguments":{"kind":"work_instruction","id":"row-1"}}' },
        { type: 'function_call_output', call_id: 'call-business-detail', output: '<untrusted_tool_result>note\n{"result":"{\\"workInstructions\\":[{\\"id\\":\\"row-1\\",\\"kind\\":\\"work_instruction\\",\\"partNumber\\":\\"PN-1\\",\\"steps\\":[{\\"step\\":1,\\"text\\":\\"one\\"},{\\"step\\":2,\\"text\\":\\"two\\"}]}]}"}</untrusted_tool_result>' },
        { type: 'message', content: [{ type: 'output_text', text: '{"message":"確認済み","title":"PN-1相談","relatedIdentifiers":["PN-1"],"confirmedFacts":["step 1"],"openQuestions":[],"summary":"要約"}' }] },
        { type: 'message', content: [{ type: 'output_text', text: '表示本文' }] }
      ] } })}\n\n`
    ].join(''), { headers: { 'content-type': 'text/event-stream' } }));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'business-hermes-chat', timeoutMs: 5_000 } });
    const result = await service.chat({ consultationId, message: '続き' });
    expect(result.message).toBe('確認済み');
    expect(result.evidence.map((item) => item.id)).toEqual(['row-1:step:1', 'row-1:step:2']);
    expect(result.consultation.relatedIdentifiers).toEqual(['PN-1']);
    expect(result.consultation.confirmedFacts).toEqual(['step 1']);
    expect(result.consultation.summary).toBe('要約');
    expect(result.consultation.enabled).toBe(true);
  });

  it('lets a later canonical title refine an automatically generated case title', async () => {
    const fixture = dbFixture();
    fixture.row.title = '漏れ原因の確認';
    const fetchImpl = vi.fn().mockResolvedValue(new Response([
      `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output_text: '{"message":"PN-Bの組立工程を確認します","title":"PN-B 組立シール面の漏れ","relatedIdentifiers":["PN-B"],"confirmedFacts":[],"openQuestions":[],"summary":"PN-Bの組立工程を確認"}' } })}\n\n`
    ].join(''), { headers: { 'content-type': 'text/event-stream' } }));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'business-hermes-chat', timeoutMs: 5_000 } });
    const result = await service.chat({ consultationId, message: 'PN-Bの組立工程に訂正します' });
    expect(result.consultation.title).toBe('PN-B 組立シール面の漏れ');
  });

  it('does not expose malformed canonical JSON as the user-facing answer', async () => {
    const fixture = dbFixture();
    const malformed = '{"message":"確認済み\n内部改行"}';
    const fetchImpl = vi.fn().mockResolvedValue(new Response([
      `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output_text: malformed } })}\n\n`
    ].join(''), { headers: { 'content-type': 'text/event-stream' } }));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'business-hermes-chat', timeoutMs: 5_000 } });
    const result = await service.chat({ consultationId, message: '確認してください' });
    expect(result.status).toBe('unavailable');
    expect(result.reasonCode).toBe('HERMES_RESPONSE_INVALID');
    expect(result.message).toBeNull();
  });

  it('returns the existing upstream failure contract for the Hermes retry failure envelope', async () => {
    const fixture = dbFixture();
    const fetchImpl = vi.fn().mockResolvedValue(new Response([
      `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output_text: 'API call failed after 3 retries: HTTP 502: bad gateway: [Errno 111] Connection refused' } })}\n\n`
    ].join(''), { headers: { 'content-type': 'text/event-stream' } }));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'business-hermes-chat', timeoutMs: 5_000 } });

    const result = await service.chat({ consultationId, message: '訂正を確認してください' });

    expect(result).toMatchObject({ status: 'unavailable', reasonCode: 'HERMES_UPSTREAM_UNAVAILABLE', message: null });
    expect(fixture.messages.map((message) => message.role)).toEqual(['user']);
    expect(fixture.db.businessHermesConsultation.update).not.toHaveBeenCalled();
  });

  it('keeps the same text when a normal JSON answer quotes the upstream error', async () => {
    const fixture = dbFixture();
    const quoted = 'API call failed after 3 retries: HTTP 502: bad gateway: [Errno 111] Connection refused';
    const fetchImpl = vi.fn().mockResolvedValue(new Response([
      `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output_text: JSON.stringify({ message: quoted, needsClarification: false }) } })}\n\n`
    ].join(''), { headers: { 'content-type': 'text/event-stream' } }));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'business-hermes-chat', timeoutMs: 5_000 } });

    const result = await service.chat({ consultationId, message: 'エラー文を引用して確認してください' });

    expect(result).toMatchObject({ status: 'ready', message: quoted });
    expect(fixture.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
  });

  it('returns an optional model-requested confirmation without deriving one from identifiers', async () => {
    const fixture = dbFixture();
    const fetchImpl = vi.fn().mockResolvedValue(new Response([
      `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output_text: '{"message":"候補を確認しました","title":"漏れ調査","relatedIdentifiers":["PN-B"],"confirmedFacts":[],"openQuestions":["任意の追加確認"],"summary":"候補確認","needsClarification":false,"confirmation":{"prompt":"組立工程のPN-Bで続けますか？","title":"PN-B組立","relatedIdentifiers":["PN-B"]}}' } })}\n\n`
    ].join(''), { headers: { 'content-type': 'text/event-stream' } }));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'business-hermes-chat', timeoutMs: 5_000 } });
    const result = await service.chat({ consultationId, message: '候補を確認してください' });
    expect(result.needsClarification).toBe(false);
    expect(result.message).toBe('候補を確認しました');
    expect(result.consultation.openQuestions).toEqual([]);
    expect(result.confirmation).toEqual({ prompt: '組立工程のPN-Bで続けますか？', title: 'PN-B組立', relatedIdentifiers: ['PN-B'] });
    const reopened = await service.get(consultationId);
    expect(reopened?.messages.at(-1)?.confirmation).toEqual(result.confirmation);
  });

  it('keeps a button selection contextual for Hermes while storing a user-facing selection event', async () => {
    const fixture = dbFixture();
    const fetchImpl = vi.fn().mockResolvedValue(new Response([
      `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output_text: '{"message":"選択内容を確認します。","title":"候補確認","relatedIdentifiers":[],"confirmedFacts":[],"openQuestions":[],"summary":"候補確認"}' } })}\n\n`
    ].join(''), { headers: { 'content-type': 'text/event-stream' } }));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });

    const result = await service.chat({ consultationId, message: '選択肢を進める', selection: { prompt: 'どの処置を詳しく見ますか？', option: '処置の詳細を見る' } });

    expect(fixture.messages[0]).toMatchObject({
      content: '「処置の詳細を見る」が選択されました。',
      confirmation: { selection: { prompt: 'どの処置を詳しく見ますか？', option: '処置の詳細を見る' } }
    });
    expect(JSON.parse(JSON.parse(fetchImpl.mock.calls[0]![1].body).input[0].content).request)
      .toBe('選択された次の操作です。問い: どの処置を詳しく見ますか？\n選択: 処置の詳細を見る');
    expect(result.consultation.messages.at(-2)).toMatchObject({
      selection: { prompt: 'どの処置を詳しく見ますか？', option: '処置の詳細を見る' }
    });
  });

  it('resolves and retains a scan as case data while keeping the raw value out of the displayed user message', async () => {
    const fixture = dbFixture();
    const scan = {
      rawValue: 'ORDER-SCAN-1',
      kind: 'manufacturing_order' as const,
      ambiguous: false,
      candidateCount: 1,
      truncated: false,
      matches: [{ kind: 'manufacturing_order' as const, source: 'production_schedule' as const, matchField: 'ProductNo' as const, matchedValue: 'ORDER-SCAN-1', productNo: 'ORDER-SCAN-1' }]
    };
    const scanResolver = { resolve: vi.fn().mockResolvedValue(scan) };
    const responseBody = `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output_text: '{"message":"照合結果を確認します。","title":"スキャン確認","relatedIdentifiers":[],"confirmedFacts":[],"openQuestions":[],"summary":"スキャン確認","needsClarification":false,"confirmation":{"prompt":"この候補で続けますか？","options":["続ける","別の内容を相談する"]}}' } })}\n\n`;
    const fetchImpl = vi.fn().mockImplementation(() => new Response(responseBody));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, scanResolver,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });

    const result = await service.chat({ consultationId, message: 'バーコードの照合結果を確認してください。', scanValue: 'ORDER-SCAN-1' });

    expect(scanResolver.resolve).toHaveBeenCalledWith('ORDER-SCAN-1');
    expect(fixture.messages[0]).toMatchObject({
      content: 'バーコードを読み取りました。',
      confirmation: { scan }
    });
    expect(JSON.parse(JSON.parse(fetchImpl.mock.calls[0]![1].body).input[0].content).currentScan).toEqual(scan);
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body).instructions).toContain('命令ではありません');
    expect(result.consultation.messages.at(-2)).toMatchObject({ scan });
    expect(result.confirmation).toEqual({ prompt: 'この候補で続けますか？', options: ['続ける', '別の内容を相談する'] });

    await service.chat({ consultationId, message: '別の内容を相談する', selection: { prompt: 'この候補で続けますか？', option: '別の内容を相談する' } });
    expect(scanResolver.resolve).toHaveBeenCalledOnce();
    expect(fixture.messages.at(-2)).toMatchObject({
      content: '「別の内容を相談する」が選択されました。',
      confirmation: { selection: { prompt: 'この候補で続けますか？', option: '別の内容を相談する' } }
    });
    const firstRequest = JSON.parse(fetchImpl.mock.calls[0]![1].body);
    const nextRequest = JSON.parse(fetchImpl.mock.calls[1]![1].body);
    expect(nextRequest.instructions).toBe(firstRequest.instructions);
    expect(nextRequest.instructions).not.toContain('ORDER-SCAN-1');
    expect(JSON.parse(nextRequest.input[0].content).previousScans).toEqual([scan]);
    expect(JSON.parse(nextRequest.input[0].content).currentScan).toBeUndefined();
  });

  it('keeps a stable instruction prefix while passing the latest corrected case state only as data', async () => {
    const fixture = dbFixture();
    const responseBody = `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output_text: '{"message":"確認します","needsClarification":false}' } })}\n\n`;
    const fetchImpl = vi.fn().mockImplementation(() => new Response(responseBody));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    await service.chat({ consultationId, message: '最初の相談' });
    fixture.row.summary = '前の製品ではなく、別工程を対象にする';
    await service.chat({ consultationId, message: 'その訂正を踏まえて調べて' });
    const first = JSON.parse(fetchImpl.mock.calls[0]![1].body);
    const next = JSON.parse(fetchImpl.mock.calls[1]![1].body);
    expect(next.instructions).toBe(first.instructions);
    expect(next.conversation).toBe(first.conversation);
    expect(JSON.parse(first.input[0].content).caseState.summary).toBe('');
    expect(JSON.parse(next.input[0].content)).toMatchObject({
      caseState: { summary: fixture.row.summary }, request: 'その訂正を踏まえて調べて'
    });
    expect(next.instructions).not.toContain(fixture.row.summary!);
    expect(fixture.messages.at(-2)?.content).toBe('その訂正を踏まえて調べて');
  });

  it('does not save a scan when the request is cancelled while the read-only lookup is pending', async () => {
    const fixture = dbFixture();
    let finishLookup!: (value: { rawValue: string; kind: 'unknown'; ambiguous: false; candidateCount: number; truncated: false; matches: [] }) => void;
    const scanResolver = { resolve: vi.fn(() => new Promise((resolve) => { finishLookup = resolve; })) };
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, scanResolver,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    const abort = new AbortController();
    const request = service.chat({ consultationId, message: 'スキャンを確認してください。', scanValue: 'PENDING-SCAN', signal: abort.signal });

    await vi.waitFor(() => expect(scanResolver.resolve).toHaveBeenCalled());
    abort.abort();
    finishLookup({ rawValue: 'PENDING-SCAN', kind: 'unknown', ambiguous: false, candidateCount: 0, truncated: false, matches: [] });

    await expect(request).resolves.toMatchObject({ status: 'unavailable', reasonCode: 'HERMES_TIMEOUT' });
    expect(fixture.messages).toHaveLength(0);
    expect(fixture.db.businessHermesConsultation.update).not.toHaveBeenCalled();
  });

  it('returns a scan lookup failure without treating it as an unknown match', async () => {
    const fixture = dbFixture();
    const scanResolver = { resolve: vi.fn().mockRejectedValue(new Error('read-only lookup failed')) };
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, scanResolver,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });

    await expect(service.chat({ consultationId, message: 'スキャンを確認してください。', scanValue: 'FAILED-SCAN' })).resolves.toMatchObject({
      status: 'unavailable',
      reasonCode: 'HERMES_SCAN_LOOKUP_UNAVAILABLE'
    });
    expect(fixture.messages).toHaveLength(0);
  });

  it('keeps an acknowledgement before valid case metadata without displaying the JSON', async () => {
    const fixture = dbFixture();
    const text = '了解しました。相談を締め切ります。\n\n'+JSON.stringify({title:'相談終了',relatedIdentifiers:[],confirmedFacts:[],openQuestions:[],summary:'利用者が相談を終了。'});
    const fetchImpl = vi.fn().mockResolvedValue(new Response('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]}})+'\n\n'));
    const service = new BusinessHermesConsultationService({db:fixture.db as never,fetchImpl,config:{baseUrl:'http://hermes.local',apiKey:'secret',model:'chat'}});
    const response = await service.chat({consultationId,message:'ここで終わります'});
    expect(response.status).toBe('ready');
    expect(response.message).toBe('了解しました。相談を締め切ります。');
    expect(response.consultation.summary).toBe('利用者が相談を終了。');
  });

  it('uses the final state and confirmation after native tool-phase JSON drafts', async () => {
    const fixture = dbFixture();
    const draft = { message: '次は別工程です。', title: '途中の相談名', summary: '別工程へ進む予定', openQuestions: ['別工程は済みましたか'] };
    const final = { message: '組立の確認はできましたか？', title: '組立の相談', summary: '組立の確認中', openQuestions: ['組立の確認'], confirmation: { prompt: '組立の確認はできましたか？', options: ['はい', 'いいえ'] } };
    const text = 'API call failed after 3 retries: HTTP 502: bad gateway: [Errno 111] Connection refused\n'
      + JSON.stringify(draft) + '\n\n' + JSON.stringify(final);
    const fetchImpl = vi.fn().mockResolvedValue(new Response('data: ' + JSON.stringify({
      type: 'response.completed', response: { status: 'completed', output: [
        { type: 'message', content: [{ type: 'output_text', text }] }
      ] }
    }) + '\n\n'));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    const result = await service.chat({ consultationId, message: '組立を確認したい' });
    expect(result.message).toBe(final.message);
    expect(result.confirmation).toEqual(final.confirmation);
    expect(result.consultation).toMatchObject({ title: final.title, summary: final.summary, openQuestions: final.openQuestions });
    expect(fixture.messages.at(-1)?.content).toBe(final.message);
  });

  it('times out, releases the runtime, and allows another request in the same case', async () => {
    vi.useFakeTimers();
    try {
      const fixture = dbFixture();
      const fetchImpl = vi.fn((_url: URL, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }));
      const runtime = {ensureReady: vi.fn().mockResolvedValue(undefined), release: vi.fn().mockResolvedValue(undefined)};
      const service = new BusinessHermesConsultationService({db: fixture.db as never, fetchImpl, runtime: runtime as never,
        config: {baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat', provider: 'dgx', timeoutMs: 500}});
      const first = service.chat({consultationId, message: '時間切れになる調査'});
      await vi.advanceTimersByTimeAsync(501);
      expect((await first).reasonCode).toBe('HERMES_TIMEOUT');
      expect(runtime.release).toHaveBeenCalledTimes(1);
      fetchImpl.mockResolvedValueOnce(new Response('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'再開しました。'}]}]}})+'\n\n'));
      const second = await service.chat({consultationId, message: '再開'});
      expect(second.status).toBe('ready');
      expect(runtime.release).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it('cancels while runtime readiness is pending and releases once after late readiness', async () => {
    const fixture = dbFixture();
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
    const runtime = {
      ensureReady: vi.fn().mockReturnValue(ready),
      release: vi.fn().mockResolvedValue(undefined),
      getMode: vi.fn().mockReturnValue('on_demand')
    };
    const fetchImpl = vi.fn().mockResolvedValue(new Response('data: ' + JSON.stringify({
      type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '再開しました。' }] }] }
    }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } }));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, runtime,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat', provider: 'dgx' } });
    const abort = new AbortController();
    const first = service.chat({ consultationId, message: '準備中に中断', signal: abort.signal });

    await vi.waitFor(() => expect(runtime.ensureReady).toHaveBeenCalledWith('business_hermes'));
    abort.abort();
    await expect(first).resolves.toMatchObject({ status: 'unavailable', reasonCode: 'HERMES_TIMEOUT' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fixture.db.businessHermesConsultation.update).not.toHaveBeenCalled();
    const resumed = service.chat({ consultationId, message: '再開' });
    await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();
    resolveReady();
    const resumedResult = await resumed;
    expect(resumedResult.status).toBe('ready');
    await vi.waitFor(() => expect(runtime.release).toHaveBeenCalledTimes(2));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('times out while runtime readiness remains unresolved', async () => {
    vi.useFakeTimers();
    try {
      const fixture = dbFixture();
      const ready = new Promise<void>(() => undefined);
      const runtime = {
        ensureReady: vi.fn().mockReturnValue(ready),
        release: vi.fn().mockResolvedValue(undefined),
        getMode: vi.fn().mockReturnValue('on_demand')
      };
      const fetchImpl = vi.fn();
      const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, runtime,
        config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat', provider: 'dgx', timeoutMs: 500 } });
      const request = service.chat({ consultationId, message: '準備待ちで時間切れ' });

      await vi.advanceTimersByTimeAsync(501);
      await expect(request).resolves.toMatchObject({ status: 'unavailable', reasonCode: 'HERMES_TIMEOUT' });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(fixture.db.businessHermesConsultation.update).not.toHaveBeenCalled();
      expect(runtime.release).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('does not release a runtime when a cancelled readiness later fails', async () => {
    const fixture = dbFixture();
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((_resolve, reject) => { rejectReady = reject; });
    const runtime = {
      ensureReady: vi.fn().mockReturnValue(ready),
      release: vi.fn().mockResolvedValue(undefined),
      getMode: vi.fn().mockReturnValue('on_demand')
    };
    const fetchImpl = vi.fn();
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, runtime,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat', provider: 'dgx' } });
    const abort = new AbortController();
    const request = service.chat({ consultationId, message: '準備失敗前に中断', signal: abort.signal });

    await vi.waitFor(() => expect(runtime.ensureReady).toHaveBeenCalled());
    abort.abort();
    await expect(request).resolves.toMatchObject({ status: 'unavailable', reasonCode: 'HERMES_TIMEOUT' });
    rejectReady(new Error('runtime start failed'));
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.release).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not save a late answer when cancelled during source verification', async () => {
    const fixture = dbFixture();
    let finishLookup!: (assets: []) => void;
    const activeAssetLookup = vi.fn(() => new Promise<[]>((resolve) => { finishLookup = resolve; }));
    const fetchImpl = vi.fn().mockResolvedValue(new Response('data: ' + JSON.stringify({
      type: 'response.completed', response: { status: 'completed', output: [
        { type: 'message', content: [{ type: 'output_text', text: '遅れて届いた回答です。' }] }
      ] }
    }) + '\n\n'));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, activeAssetLookup,
      config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    const request = service.chat({ consultationId, message: '調査してください' });
    await vi.waitFor(() => expect(activeAssetLookup).toHaveBeenCalled());
    const cancellation = service.cancel(consultationId);
    finishLookup([]);
    expect(await cancellation).toBe(true);
    expect((await request).status).toBe('unavailable');
    expect(fixture.messages.map((message) => message.role)).toEqual(['user']);
    expect(fixture.db.businessHermesConsultation.update).not.toHaveBeenCalled();
  });

  it('aborts an upstream stream and rejects concurrent work for the same case', async () => {
    const fixture = dbFixture();
    let resolveFetch!: (response: Response) => void;
    const fetchImpl = vi.fn((_url: URL, options: RequestInit) => new Promise<Response>((resolve, reject) => {
      resolveFetch = resolve;
      options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat', timeoutMs: 5_000 } });
    const abort = new AbortController();
    const first = service.chat({ consultationId, message: '中断対象', signal: abort.signal });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    const busy = await service.chat({ consultationId, message: '同時実行' });
    expect(busy.reasonCode).toBe('HERMES_CONSULTATION_BUSY');
    expect(await service.cancel(consultationId)).toBe(true);
    const cancelled = await first;
    expect(await service.cancel(consultationId)).toBe(false);
    expect(cancelled.reasonCode).toBe('HERMES_TIMEOUT');
    expect(resolveFetch).toBeDefined();
  });
});
