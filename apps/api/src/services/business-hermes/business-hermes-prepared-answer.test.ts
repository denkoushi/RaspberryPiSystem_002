import { describe, expect, it, vi } from 'vitest';
import { BusinessHermesPreparedAnswer, preparedSource } from './business-hermes-prepared-answer.js';

const record = { kind: 'nonconformity', id: 'r1', condition: '下穴が深すぎる', remarks: '裏面が膨らむ', correctiveContent: '1mm以上残す' };
const source = { record, result: { content: [{ type: 'text' as const, text: JSON.stringify(record) }] } };
describe('BusinessHermesPreparedAnswer', () => {
  it('reads the selected current source and performs exactly one tool-free completion with a balanced lease', async () => {
    const cache = { source: vi.fn().mockResolvedValue(source) };
    const completion = { complete: vi.fn().mockResolvedValue({ rawText: JSON.stringify({ answer: '1mm以上残す。', source_ids: ['r1'] }), model: 'system-prod-primary' }) };
    const runtime = { ensureReady: vi.fn().mockResolvedValue(undefined), release: vi.fn().mockResolvedValue(undefined) };
    const service = new BusinessHermesPreparedAnswer(cache, completion, runtime as never);
    const result = await service.answer('この資料で回答：記録1', '再発防止は？', new AbortController().signal);
    expect(completion.complete).toHaveBeenCalledTimes(1);
    expect(completion.complete.mock.calls[0]![0]).toMatchObject({ useCase: 'business_hermes', enableThinking: false });
    expect(completion.complete.mock.calls[0]![0].messages[1].content).toContain('1mm以上残す');
    expect(runtime.ensureReady).toHaveBeenCalledWith('business_hermes');
    expect(runtime.release).toHaveBeenCalledWith('business_hermes');
    expect(result.output).toHaveLength(2);
    expect(result.learning).toMatchObject({ question: '再発防止は？', answer: '1mm以上残す。', sources: [{ kind: 'nonconformity', id: 'r1', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }] });
    expect(JSON.parse(result.output_text as string).message).toBe('1mm以上残す。');
  });
  it('asks for the target again without generation when the source was removed or changed', async () => {
    const completion = { complete: vi.fn() };
    const result = await new BusinessHermesPreparedAnswer({ source: vi.fn().mockResolvedValue(null) }, completion, null)
      .answer('この資料で回答：古い記録', '対策は？', new AbortController().signal);
    expect(completion.complete).not.toHaveBeenCalled();
    expect(JSON.parse(result.output_text as string).needsClarification).toBe(true);
  });
  it('does not generate after cancellation and releases acquired runtime on failure', async () => {
    const completion = { complete: vi.fn().mockRejectedValue(Error('failed')) };
    const runtime = { ensureReady: vi.fn().mockResolvedValue(undefined), release: vi.fn().mockResolvedValue(undefined) };
    const service = new BusinessHermesPreparedAnswer({ source: vi.fn().mockResolvedValue(source) }, completion, runtime as never);
    await expect(service.answer('資料', '質問', new AbortController().signal)).rejects.toThrow('failed');
    expect(runtime.release).toHaveBeenCalledTimes(1);
    const controller = new AbortController(); controller.abort();
    await expect(service.answer('資料', '質問', controller.signal)).rejects.toThrow();
    expect(completion.complete).toHaveBeenCalledTimes(1);
  });
  it('rejects an invented source ID and preserves a model-requested clarification', async () => {
    const completion = { complete: vi.fn().mockResolvedValueOnce({ rawText: JSON.stringify({ answer: '別の対策', source_ids: ['invented'] }) })
      .mockResolvedValueOnce({ rawText: JSON.stringify({ answer: '下穴加工ですか、ピン打ち込みですか？', source_ids: [] }) }) };
    const service = new BusinessHermesPreparedAnswer({ source: vi.fn().mockResolvedValue(source) }, completion, null);
    await expect(service.answer('資料', '質問', new AbortController().signal)).rejects.toThrow('source identity');
    const result = await service.answer('資料', '質問', new AbortController().signal);
    expect(JSON.parse(result.output_text as string)).toMatchObject({ needsClarification: true, openQuestions: ['下穴加工ですか、ピン打ち込みですか？'] });
  });
  it('passes published effective step text, including an intentionally empty step', () => {
    expect(preparedSource({ kind: 'work_instruction', id: 'w1', rows: [{ steps: [{ step: 1, effectiveText: '' }, { step: 2, effectiveText: '前工程に戻す' }] }] }).steps)
      .toEqual([{ step: 1, text: '' }, { step: 2, text: '前工程に戻す' }]);
  });
});
