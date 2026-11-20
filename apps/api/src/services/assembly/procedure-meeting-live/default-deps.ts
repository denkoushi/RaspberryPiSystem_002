import { createHttpSpeechToTextAdapter } from '../../inference/adapters/http-speech-to-text.adapter.js';
import { getInferenceRuntime } from '../../inference/inference-runtime.js';

import type { CompleteFn } from './organizer.js';

/** Business speech-to-text through the existing DGX adapter (one clip at a time). */
export async function defaultTranscribe(wav: Buffer, prompt: string): Promise<string> {
  const port = createHttpSpeechToTextAdapter();
  if (!port) throw new Error('speech-to-text unavailable');
  const controller = new AbortController();
  return port.transcribe(wav, 'audio/wav', controller.signal, prompt || undefined);
}

/** Business LLM through the existing inference router (non-streaming). */
export const defaultComplete: CompleteFn = async (messages, signal) => {
  const port = getInferenceRuntime().createTextCompletionPort();
  const result = await port.complete({
    useCase: 'business_hermes', messages, maxTokens: 1500, temperature: 0.2,
    enableThinking: false, timeoutMs: 60000, signal
  });
  return result.rawText;
};

export async function defaultSttHealthy(): Promise<boolean> {
  try { return (await createHttpSpeechToTextAdapter()?.isHealthy()) ?? false; } catch { return false; }
}
