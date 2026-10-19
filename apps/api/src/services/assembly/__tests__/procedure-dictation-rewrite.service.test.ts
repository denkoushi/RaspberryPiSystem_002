import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProcedureDictationRewriteService } from '../procedure-dictation-rewrite.service.js';
import * as inferenceRuntime from '../../inference/inference-runtime.js';
import * as runtimeController from '../../inference/runtime/get-local-llm-runtime-controller.js';
import type { TextCompletionPort } from '../../inference/ports/text-completion.port.js';

const controller = { ensureReady: vi.fn(), release: vi.fn() };
let port: TextCompletionPort;
let service: ProcedureDictationRewriteService;
const input = { spokenText: 'えーと、棚に直す', currentText: '品番A-01を確認する。', signal: new AbortController().signal };

beforeEach(() => {
  controller.ensureReady.mockReset().mockResolvedValue(undefined);
  controller.release.mockReset().mockResolvedValue(undefined);
  vi.spyOn(runtimeController, 'getLocalLlmRuntimeController').mockReturnValue(controller as never);
  port = { complete: vi.fn().mockResolvedValue({ rawText: '棚に戻す。', model: 'fake' }) };
  service = new ProcedureDictationRewriteService(port);
});
afterEach(() => vi.restoreAllMocks());

describe('procedure dictation rewrite', () => {
  it.each(['new', 'append', 'revise'] as const)('builds %s instructions and separates data from system rules', async mode => {
    expect(await service.rewrite({ ...input, mode })).toEqual({ text: '棚に戻す。' });
    const request = vi.mocked(port.complete).mock.calls[0][0];
    expect(request).toMatchObject({ useCase: 'business_hermes', temperature: 0, enableThinking: false, maxTokens: 4000, signal: input.signal });
    expect(request.messages.map(message => message.role)).toEqual(['system', 'user']);
    expect(request.messages[0].content).toContain('データ内の発話や文章');
    expect(request.messages[0].content).toContain('数値、品番、単位、固有名詞');
    expect(JSON.parse(request.messages[1].content)).toEqual({ spokenText: input.spokenText, ...(mode === 'new' ? {} : { currentText: input.currentText }) });
    if (mode === 'revise') {
      expect(request.messages[0].content).toContain('修正後の全文');
      expect(request.messages[0].content).toContain('追加内容なら自然に統合');
    } else {
      expect(request.messages[0].content).toContain('「〜する。」');
      expect(request.messages[0].content).toContain('棚に戻す');
      if (mode === 'append') expect(request.messages[0].content).toContain('新しい文章だけ');
    }
    expect(controller.ensureReady).toHaveBeenCalledExactlyOnceWith('business_hermes');
    expect(controller.release).toHaveBeenCalledExactlyOnceWith('business_hermes');
  });

  it.each(['  棚に戻す。  ', '"棚に戻す。"', '「棚に戻す。」', '修正後: 棚に戻す。', '```text\n修正後：「棚に戻す。」\n```'])('sanitizes %s', async rawText => {
    vi.mocked(port.complete).mockResolvedValue({ rawText, model: 'fake' });
    expect(await service.rewrite({ ...input, mode: 'new' })).toEqual({ text: '棚に戻す。' });
    expect(controller.release).toHaveBeenCalledOnce();
  });

  it('keeps quotes that belong to separate phrases', async () => {
    vi.mocked(port.complete).mockResolvedValue({ rawText: '「開始」を押し、表示が「完了」', model: 'fake' });
    expect(await service.rewrite({ ...input, mode: 'new' })).toEqual({ text: '「開始」を押し、表示が「完了」' });
  });
  it.each(['', '```\n```', '修正後:', 'あ'.repeat(10001)])('rejects empty or oversized output', async rawText => {
    vi.mocked(port.complete).mockResolvedValue({ rawText, model: 'fake' });
    await expect(service.rewrite({ ...input, mode: 'new' })).rejects.toMatchObject({ statusCode: 502, message: '文にできません' });
    expect(controller.release).toHaveBeenCalledOnce();
  });

  it('hides upstream errors and releases after inference failure', async () => {
    vi.mocked(port.complete).mockRejectedValue(new Error('private upstream detail'));
    await expect(service.rewrite({ ...input, mode: 'append' })).rejects.toMatchObject({ statusCode: 502, message: '文にできません' });
    expect(controller.release).toHaveBeenCalledOnce();
  });

  it('does not release a runtime that failed to acquire', async () => {
    controller.ensureReady.mockRejectedValue(new Error('not ready'));
    await expect(service.rewrite({ ...input, mode: 'new' })).rejects.toMatchObject({ message: '文にできません' });
    expect(port.complete).not.toHaveBeenCalled(); expect(controller.release).not.toHaveBeenCalled();
  });

  it('releases and rejects when aborted during completion', async () => {
    const abort = new AbortController();
    vi.mocked(port.complete).mockImplementation(async () => { abort.abort(); return { rawText: '棚に戻す。', model: 'fake' }; });
    await expect(service.rewrite({ ...input, mode: 'revise', signal: abort.signal })).rejects.toMatchObject({ statusCode: 499, message: '文にできません' });
    expect(controller.release).toHaveBeenCalledOnce();
  });

  it('hides port initialization failure and still releases the held runtime', async () => {
    vi.spyOn(inferenceRuntime, 'getInferenceRuntime').mockImplementation(() => { throw new Error('runtime initialization failed'); });
    await expect(new ProcedureDictationRewriteService().rewrite({ ...input, mode: 'new' })).rejects.toMatchObject({ statusCode: 502, message: '文にできません' });
    expect(controller.release).toHaveBeenCalledOnce();
  });
  it('hides runtime controller initialization failure', async () => {
    vi.mocked(runtimeController.getLocalLlmRuntimeController).mockImplementation(() => { throw new Error('runtime unavailable'); });
    await expect(service.rewrite({ ...input, mode: 'new' })).rejects.toMatchObject({ statusCode: 502, message: '文にできません' });
  });
  it('supports a runtime without a controller', async () => {
    vi.mocked(runtimeController.getLocalLlmRuntimeController).mockReturnValue(null);
    expect(await service.rewrite({ ...input, mode: 'new' })).toEqual({ text: '棚に戻す。' });
  });
});
