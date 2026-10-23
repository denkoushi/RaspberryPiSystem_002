export interface SpeechToTextPort {
  isHealthy(): Promise<boolean>;
  transcribe(audio: Buffer, contentType: string, signal: AbortSignal, prompt?: string): Promise<string>;
}

/** Only safe response metadata crosses the adapter boundary. */
export class SpeechToTextUpstreamError extends Error {
  constructor(public readonly status: number, public readonly retryAfter: string | null = null) {
    super('Speech to text upstream failed');
  }
}
