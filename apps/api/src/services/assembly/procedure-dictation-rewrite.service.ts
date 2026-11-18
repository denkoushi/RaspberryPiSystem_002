import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { getInferenceRuntime } from '../inference/inference-runtime.js';
import { getLocalLlmRuntimeController } from '../inference/runtime/get-local-llm-runtime-controller.js';
import type { TextCompletionPort } from '../inference/ports/text-completion.port.js';
import { buildProcedureDictationMessages, type ProcedureDictationLearning, type ProcedureDictationRewriteInput } from './procedure-dictation-prompt.js';
import { loadAdoptedDictationLearning } from './procedure-dictation-learning.js';

export type { ProcedureDictationRewriteInput } from './procedure-dictation-prompt.js';

function sanitize(raw: string): string {
  let text = raw.trim();
  // Wrappers can nest (e.g. a label inside a code fence).
  for (let i = 0; i < 3; i++) {
    text = text.replace(/^```[^\n]*\n([\s\S]*?)\n?```$/, '$1').trim()
      .replace(/^(?:修正後|書き直し後|変換後|文章|出力|結果)\s*[:：]\s*/, '').trim();
    const pairs = [['"', '"'], ["'", "'"], ['「', '」'], ['『', '』'], ['“', '”']];
    for (const [open, close] of pairs) {
      const inner = text.slice(open.length, -close.length);
      // Only a single wrapping pair is a wrapper; 「開始」を押し「完了」 keeps its quotes.
      if (text.length >= 2 && text.startsWith(open) && text.endsWith(close) && !inner.includes(open) && !inner.includes(close)) text = inner.trim();
    }
  }
  if (!text || text.length > 10000) throw new Error('Invalid dictation output');
  return text;
}

export async function completeProcedureDictation(
  text: TextCompletionPort,
  input: ProcedureDictationRewriteInput & { learning?: ProcedureDictationLearning; signal?: AbortSignal; background?: boolean },
): Promise<string> {
  const result = await text.complete({
    useCase: 'business_hermes', temperature: 0, enableThinking: false, maxTokens: 4000, signal: input.signal,
    ...(input.background === undefined ? {} : { background: input.background }),
    messages: buildProcedureDictationMessages(input),
  });
  input.signal?.throwIfAborted();
  return sanitize(result.rawText);
}

export class ProcedureDictationRewriteService {
  constructor(private readonly text?: TextCompletionPort) {}

  async rewrite(input: ProcedureDictationRewriteInput & { signal: AbortSignal; documentId?: string }): Promise<{ text: string }> {
    try {
      input.signal.throwIfAborted();
      const learning = input.documentId ? await loadAdoptedDictationLearning(input.documentId, input.signal) : undefined;
      input.signal.throwIfAborted();
      const runtime = getLocalLlmRuntimeController();
      let held = false;
      try {
        if (runtime) { await runtime.ensureReady('business_hermes'); held = true; }
        input.signal.throwIfAborted();
        return { text: await completeProcedureDictation(this.text ?? getInferenceRuntime().createTextCompletionPort(), { ...input, learning }) };
      } finally {
        if (held && runtime) await runtime.release('business_hermes');
      }
    } catch (error) {
      logger.warn({ err: error, mode: input.mode, aborted: input.signal.aborted }, 'assembly_procedure_dictation_rewrite_failed');
      throw new ApiError(input.signal.aborted ? 499 : 502, '文にできません', undefined, 'ASSEMBLY_PROCEDURE_DICTATION_FAILED');
    }
  }
}
