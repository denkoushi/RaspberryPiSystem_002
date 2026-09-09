import { describe, expect, it, vi } from 'vitest';

import { env } from '../../config/env.js';

import { BusinessHermesConsultationService } from './business-hermes-consultation.service.js';
import { projectTrustedEvidence } from './business-hermes-evidence.js';

const consultationId = '00000000-0000-0000-0000-000000000010';

function dbFixture() {
  const messages: Array<{ id: string; role: string; content: string; evidence: unknown; confirmation?: unknown; searchDiagnostics?: unknown; createdAt: Date }> = [];
  const row = {
    id: consultationId,
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
      findUnique: vi.fn(async (input: { select?: unknown }) => input.select ? { hermesConversationId: row.hermesConversationId } : { ...row, messages: [...messages].reverse() }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { Object.assign(row, data); row.updatedAt = new Date(); return row; }),
      create: vi.fn()
    },
      businessHermesConsultationMessage: {
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

describe('BusinessHermesConsultationService', () => {
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
    const fixture = dbFixture();
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
    expect(result.consultation.messages[0]).toMatchObject({
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
    expect(result.consultation.messages[0]).toMatchObject({ scan });
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
