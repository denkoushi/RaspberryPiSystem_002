import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { createHttpSpeechToTextAdapter } from '../inference/adapters/http-speech-to-text.adapter.js';
import { SpeechToTextUpstreamError, type SpeechToTextPort } from '../inference/ports/speech-to-text.port.js';

export const PROCEDURE_AUDIO_MAX_BYTES = 2_000_000;
export function procedureSpeechToTextError(status: number): ApiError {
  const kind = status === 429 ? 'BUSY' : status === 413 ? 'TOO_LARGE' : status === 400 ? 'INVALID' : 'UNAVAILABLE';
  const message = kind === 'BUSY' ? '混んでいます' : kind === 'TOO_LARGE' ? '長すぎます' : kind === 'INVALID' ? '音声データが正しくありません' : '音声認識が動いていません';
  return new ApiError(status, message, undefined, `ASSEMBLY_PROCEDURE_SPEECH_TO_TEXT_${kind}`);
}

export class ProcedureSpeechToTextService {
  constructor(private readonly port?: SpeechToTextPort | null) {}

  async isAvailable(): Promise<boolean> {
    try { return await (this.port === undefined ? createHttpSpeechToTextAdapter() : this.port)?.isHealthy() ?? false; }
    catch { return false; }
  }

  async transcribe(audio: Buffer, contentType: string, signal: AbortSignal): Promise<{ text: string }> {
    try {
      signal.throwIfAborted();
      if (audio.length > PROCEDURE_AUDIO_MAX_BYTES) throw procedureSpeechToTextError(413);
      const port = this.port === undefined ? createHttpSpeechToTextAdapter() : this.port;
      if (!port) throw procedureSpeechToTextError(503);
      const text = await port.transcribe(audio, contentType, signal);
      signal.throwIfAborted();
      return { text: text.trim() };
    } catch (error) {
      const status = signal.aborted ? 499 : error instanceof SpeechToTextUpstreamError && [400, 413, 429].includes(error.status) ? error.status : error instanceof ApiError ? error.statusCode : 503;
      const safe = procedureSpeechToTextError(status);
      if (status === 429 && error instanceof SpeechToTextUpstreamError) {
        const value = error.retryAfter;
        safe.details = { retryAfter: value && /^[1-9]\d?$/.test(value) ? Number(value) : 2 };
      }
      logger.warn({ status, code: safe.code, aborted: signal.aborted }, 'assembly_procedure_speech_to_text_failed');
      throw safe;
    }
  }
}
