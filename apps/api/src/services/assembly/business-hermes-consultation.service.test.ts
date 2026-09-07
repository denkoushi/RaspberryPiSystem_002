import { describe, expect, it, vi } from 'vitest';

import { BusinessHermesConsultationService, projectTrustedEvidence } from './business-hermes-consultation.service.js';

const consultationId = '00000000-0000-0000-0000-000000000010';

function dbFixture() {
  const messages: Array<{ id: string; role: string; content: string; evidence: unknown; createdAt: Date }> = [];
  const row = {
    id: consultationId,
    title: null,
    relatedIdentifiers: [],
    confirmedFacts: [],
    openQuestions: [],
    summary: null,
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
      create: vi.fn(async ({ data }: { data: { role: string; content: string; evidence: unknown } }) => {
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

  it('uses the official Responses envelope, session key, runtime lease, and persists case-scoped history', async () => {
    const fixture = dbFixture();
    const fetchImpl = vi.fn().mockResolvedValue(new Response([
      `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [
        { type: 'function_call', name: 'mcp__business_api__business_hermes_search', call_id: 'call-business-search', arguments: '{"query":"本文"}' },
        { type: 'function_call_output', call_id: 'call-business-search', output: '<untrusted_tool_result source="business_api">\nExplanation from tool\n\n{"result":"{\\"evidence\\":[{\\"kind\\":\\"work_instruction\\",\\"id\\":\\"step-1\\",\\"partNumber\\":\\"PN-1\\",\\"text\\":\\"公開本文\\",\\"asset_id\\":\\"asset-1\\",\\"photo_url\\":\\"https://model.invalid/fake.jpg\\"}]}"}\n</untrusted_tool_result>' },
        { type: 'function_call', name: 'skill_view', call_id: 'call-skill-view', arguments: '{"name":"business-consultation"}' },
        { type: 'function_call_output', call_id: 'call-skill-view', output: '{"kind":"work_instruction","id":"skill-fake","partNumber":"PN-FAKE","text":"skill text"}' },
        { type: 'message', content: [{ type: 'output_text', text: '次に確認してください。' }] }
      ] } })}\n\n`
    ].join(''), { headers: { 'content-type': 'text/event-stream' } }));
    const runtime = { ensureReady: vi.fn().mockResolvedValue(undefined), release: vi.fn().mockResolvedValue(undefined), getMode: vi.fn().mockReturnValue('always_on') };
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, runtime, config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'business-hermes-chat', provider: 'dgx', timeoutMs: 5_000 } });
    const result = await service.chat({ consultationId, message: '本文を確認してください' });
    expect(result.status).toBe('ready');
    expect(result.evidence[0]).toMatchObject({ imageAssetId: 'asset-1', imageUrl: '/api/work-instructions/assets/asset-1' });
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      headers: expect.objectContaining({ 'X-Hermes-Session-Key': 'hermes-conversation-1' }),
      body: expect.stringContaining('全キーを含めます')
    }));
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body)).toMatchObject({ conversation: 'hermes-conversation-1', store: true });
    expect(runtime.ensureReady).toHaveBeenCalledWith('business_hermes');
    expect(runtime.release).toHaveBeenCalledWith('business_hermes');
    expect(fixture.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
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
      { type: 'response.completed', response: { status: 'completed', output: [call, { ...full, output: [{ type: 'input_text', text: output[0].text.slice(0, 500) + '...[more chars]' }] }, { type: 'message', content: [{ type: 'output_text', text: '公開要領を確認しました。' }] }] } }
    ];
    const fetchImpl = vi.fn().mockResolvedValue(new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'chat' } });
    const result = await service.chat({ consultationId, message: '漏れを確認したい' });
    expect(result.status).toBe('ready');
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ id: 'step-1', imageAssetId: 'asset-1', text: '公開手順。'.repeat(250) });
    expect(fixture.messages.at(-1)?.evidence).toEqual(result.evidence);
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

  it('returns an optional model-requested confirmation without deriving one from identifiers', async () => {
    const fixture = dbFixture();
    const fetchImpl = vi.fn().mockResolvedValue(new Response([
      `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output_text: '{"message":"候補を確認しました","title":"漏れ調査","relatedIdentifiers":["PN-B"],"confirmedFacts":[],"openQuestions":[],"summary":"候補確認","confirmation":{"prompt":"組立工程のPN-Bで続けますか？","title":"PN-B組立","relatedIdentifiers":["PN-B"]}}' } })}\n\n`
    ].join(''), { headers: { 'content-type': 'text/event-stream' } }));
    const service = new BusinessHermesConsultationService({ db: fixture.db as never, fetchImpl, config: { baseUrl: 'http://hermes.local', apiKey: 'secret', model: 'business-hermes-chat', timeoutMs: 5_000 } });
    const result = await service.chat({ consultationId, message: '候補を確認してください' });
    expect(result.needsClarification).toBe(true);
    expect(result.message).toBe('候補を確認しました');
    expect(result.confirmation).toEqual({ prompt: '組立工程のPN-Bで続けますか？', title: 'PN-B組立', relatedIdentifiers: ['PN-B'] });
    const reopened = await service.get(consultationId);
    expect(reopened?.messages.at(-1)?.confirmation).toEqual(result.confirmation);
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
    const text = '調査しています。\n' + JSON.stringify(draft) + '\n\n' + JSON.stringify(final);
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
