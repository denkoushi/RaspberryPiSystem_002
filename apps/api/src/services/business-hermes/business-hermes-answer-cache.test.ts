import { describe, expect, it, vi } from 'vitest';
import { BusinessHermesAnswerCache, sourceFingerprint } from './business-hermes-answer-cache.js';

const detail = { content: [{ type: 'text' as const, text: JSON.stringify({ kind: 'nonconformity', id: 'record-1', condition: '加工漏れ', partNumber: 'A' }) }] };
const question = '部品Aの加工漏れの確認方法は？';
const stored = { question, answer: 'ボルトを通して確認します。', sources: [{ kind: 'nonconformity', id: 'record-1', sha256: sourceFingerprint(detail) }] };
const config = { baseUrl: 'http://cache.local', token: 'test-token' };

describe('reviewed answer cache', () => {
  it('returns a stored answer only after checking the current visible source', async () => {
    const call = vi.fn().mockResolvedValue(detail);
    const cache = new BusinessHermesAnswerCache({ call }, config, vi.fn().mockResolvedValue(Response.json({ result: stored })));
    const response = await cache.answer(question);
    expect(JSON.parse(response!.output_text as string).message).toBe(stored.answer);
    expect(call).toHaveBeenCalledWith('business_hermes_get_detail', { kind: 'nonconformity', id: 'record-1' });
  });

  it.each([
    { content: [{ type: 'text', text: '{"result":null}' }] },
    { content: [{ type: 'text', text: '{"condition":"updated"}' }] },
    { ...detail, isError: true }
  ])('rejects removed, changed and inaccessible records', async (current) => {
    const cache = new BusinessHermesAnswerCache({ call: vi.fn().mockResolvedValue(current) }, config,
      vi.fn().mockResolvedValue(Response.json({ result: stored })));
    expect(await cache.answer(question)).toBeNull();
  });

  it('does not treat a similar question as an exact selected question', async () => {
    const call = vi.fn();
    const cache = new BusinessHermesAnswerCache({ call }, config, vi.fn().mockResolvedValue(Response.json({ result: stored })));
    expect(await cache.answer('部品Bの加工漏れの確認方法は？')).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it('does not route an unregistered table or a mismatched source identity into reuse', async () => {
    const call = vi.fn().mockResolvedValue(detail);
    const foreign = { ...stored, sources: [{ ...stored.sources[0], kind: 'private_history' }] };
    const cache = new BusinessHermesAnswerCache({ call }, config, vi.fn().mockResolvedValue(Response.json({ result: foreign })));
    expect(await cache.answer(question)).toBeNull();
    expect(call).not.toHaveBeenCalled();
    const wrongId = { ...stored, sources: [{ ...stored.sources[0], id: 'another-record' }] };
    expect(await new BusinessHermesAnswerCache({ call }, config, vi.fn().mockResolvedValue(Response.json({ result: wrongId }))).answer(question)).toBeNull();
  });

  it('treats malformed data, missing configuration and unavailable cache as misses', async () => {
    const call = vi.fn();
    const request = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await new BusinessHermesAnswerCache({ call }, config, request).suggest(question)).toBeNull();
    request.mockResolvedValue(Response.json({ result: { ...stored, sources: [] } }));
    expect(await new BusinessHermesAnswerCache({ call }, config, request).answer(question)).toBeNull();
    request.mockClear();
    expect(await new BusinessHermesAnswerCache({ call }, { baseUrl: undefined, token: undefined }, request).suggest(question)).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});
