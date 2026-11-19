import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

import { env } from '../../../config/env.js';
import { PROCEDURE_SPEECH_HINTS } from '../../assembly/procedure-speech-hints.js';
import { getInferenceRuntime } from '../inference-runtime.js';

const MEETING_TIMEOUT_MS = 35 * 60_000;
const errorCodes = new Map([
  ['meeting_transcribe_disabled', 503],
  ['meeting_transcribe_insufficient_memory', 503],
  ['meeting_transcribe_busy', 503],
  ['meeting_transcribe_unavailable', 503],
  ['meeting_transcribe_too_large', 413],
  ['meeting_transcribe_too_long', 400],
  ['meeting_transcribe_bad_request', 400],
  ['meeting_transcribe_timeout', 504]
]);

export type MeetingAudio = { audioPath: string; audioBytes: number; mimeType: string };

export class MeetingTranscriptionError extends Error {
  constructor(
    readonly code: string,
    readonly retryable = code !== 'meeting_transcribe_disabled' && (errorCodes.get(code) ?? 0) >= 500
  ) { super(code); }
}

export function resolveMeetingTranscriptionProvider() {
  if (!env.PROCEDURE_MEETING_TRANSCRIBE_ENABLED) return null;
  try {
    const { provider } = getInferenceRuntime().router.resolve('business_hermes');
    return provider.baseUrl && provider.sharedToken ? provider : null;
  } catch {
    return null;
  }
}

export async function transcribeProcedureMeeting(audio: MeetingAudio, signal: AbortSignal): Promise<string> {
  const provider = resolveMeetingTranscriptionProvider();
  if (!provider) throw new MeetingTranscriptionError('meeting_transcribe_disabled');
  const url = new URL('/v1/audio/meeting-transcriptions', provider.baseUrl);
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const boundary = `procedure-meeting-${randomUUID()}`;
  const prompt = [PROCEDURE_SPEECH_HINTS['procedure-assembly'], PROCEDURE_SPEECH_HINTS['procedure-grinding']].join('、').slice(0, 2000);
  const start = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${prompt}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio"\r\nContent-Type: ${audio.mimeType}\r\n\r\n`);
  const end = Buffer.from(`\r\n--${boundary}--\r\n`);
  const timeout = AbortSignal.timeout(MEETING_TIMEOUT_MS);
  const requestSignal = AbortSignal.any([signal, timeout]);
  // Node HTTP leaves the response-header deadline to our signal. Fetch's default
  // header timeout would interrupt a meeting before the DGX processing deadline.
  try {
    const response = await new Promise<{ status: number; data: { text?: unknown; error?: { code?: unknown } } }>((resolve, reject) => {
      const outgoing = request(url, {
        method: 'POST',
        agent: false,
        headers: {
          'X-LLM-Token': provider.sharedToken,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': start.length + audio.audioBytes + end.length
        },
        signal: requestSignal
      });
      const body = Readable.from((async function* () {
        yield start;
        yield* createReadStream(audio.audioPath);
        yield end;
      })());
      body.on('error', (error) => outgoing.destroy(error));
      outgoing.on('error', reject);
      outgoing.on('close', () => body.destroy());
      outgoing.once('response', async (incoming) => {
        const status = incoming.statusCode ?? 0;
        try {
          const chunks: Buffer[] = [];
          let bytes = 0;
          for await (const chunk of incoming) {
            bytes += chunk.length;
            if (bytes > 8 * 1024 * 1024) throw new Error('Meeting response too large');
            chunks.push(chunk);
          }
          let data = {};
          try {
            data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            // Proxies may respond with an empty or non-JSON error body.
          }
          resolve({ status, data });
        } catch (error) {
          if (status >= 400 && status < 500) resolve({ status, data: {} });
          else reject(error);
        } finally {
          body.destroy();
          outgoing.destroy();
        }
      });
      body.pipe(outgoing);
    });
    if (response.status === 200 && typeof response.data?.text === 'string') return response.data.text;
    const code = response.data?.error?.code;
    if (typeof code === 'string' && errorCodes.get(code) === response.status) throw new MeetingTranscriptionError(code);
    throw new MeetingTranscriptionError('meeting_transcribe_failed', response.status < 400 || response.status >= 500);
  } catch (error) {
    if (timeout.aborted) throw new MeetingTranscriptionError('meeting_transcribe_timeout');
    throw error;
  }
}
