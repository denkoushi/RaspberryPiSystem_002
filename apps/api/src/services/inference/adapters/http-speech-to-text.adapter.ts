import { randomUUID } from 'node:crypto';

import { env } from '../../../config/env.js';
import { getInferenceRuntime } from '../inference-runtime.js';
import { SpeechToTextUpstreamError, type SpeechToTextPort } from '../ports/speech-to-text.port.js';
import { toWhisperPrompt } from '../whisper-prompt.js';

export class HttpSpeechToTextAdapter implements SpeechToTextPort {
  constructor(private readonly opts: { baseUrl: string; sharedToken: string }, private readonly fetchImpl: typeof fetch = fetch) {}

  async isHealthy(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await this.fetchImpl(new URL('/system/speech-to-text/health', this.opts.baseUrl), {
        headers: { 'X-LLM-Token': this.opts.sharedToken }, signal: controller.signal
      });
      if (!response.ok) return false;
      const data = await response.json() as { ok?: unknown; enabled?: unknown };
      return data.ok === true && data.enabled === true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async transcribe(audio: Buffer, contentType: string, signal: AbortSignal, prompt?: string): Promise<string> {
    signal.throwIfAborted();
    if (!['audio/webm', 'audio/wav', 'audio/x-wav', 'audio/wave'].includes(contentType)) throw new SpeechToTextUpstreamError(400);
    const boundary = `procedure-${randomUUID()}`;
    const safePrompt = typeof prompt === 'string' ? toWhisperPrompt(prompt) : undefined;
    const promptPart = safePrompt ? `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${safePrompt}\r\n` : '';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio"\r\nContent-Type: ${contentType}\r\n\r\n`),
      audio,
      Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3-turbo\r\n${promptPart}--${boundary}--\r\n`)
    ]);
    if (body.length > 2 * 1024 * 1024) throw new SpeechToTextUpstreamError(413);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40000);
    try {
      const response = await this.fetchImpl(new URL('/v1/audio/transcriptions', this.opts.baseUrl), {
        method: 'POST', headers: {
          'X-LLM-Token': this.opts.sharedToken,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(body.length)
        }, body, signal: AbortSignal.any([signal, controller.signal])
      });
      if (!response.ok) throw new SpeechToTextUpstreamError(response.status, response.headers.get('Retry-After'));
      const data = await response.json() as { text?: unknown };
      if (typeof data.text !== 'string') throw new SpeechToTextUpstreamError(503);
      signal.throwIfAborted();
      return data.text.trim();
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createHttpSpeechToTextAdapter(): SpeechToTextPort | null {
  if (!env.PROCEDURE_SPEECH_TO_TEXT_ENABLED) return null;
  try {
    const { provider } = getInferenceRuntime().router.resolve('business_hermes');
    if (!provider.baseUrl || !provider.sharedToken) return null;
    return new HttpSpeechToTextAdapter(provider);
  } catch {
    return null;
  }
}
