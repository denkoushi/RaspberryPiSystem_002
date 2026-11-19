import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../../../config/env.js';
import { transcribeProcedureMeeting } from '../../inference/adapters/http-meeting-transcription.adapter.js';
import { PROCEDURE_SPEECH_HINTS } from '../procedure-speech-hints.js';

vi.mock('node:http', async importOriginal => ({ ...await importOriginal<typeof import('node:http')>(), request: vi.fn() }));
vi.mock('../../inference/inference-runtime.js', () => ({
  getInferenceRuntime: () => ({
    router: { resolve: () => ({ provider: { baseUrl: 'http://dgx.test:38081', sharedToken: 'test-llm-token' } }) }
  })
}));

const requestMock = vi.mocked(request);

describe('meeting transcription DGX request', () => {
  let directory: string;
  let audioPath: string;
  const recording = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0xff]);
  const enabled = env.PROCEDURE_MEETING_TRANSCRIBE_ENABLED;

  function respond(statusCode: number, payload: unknown) {
    const chunks: Buffer[] = [];
    requestMock.mockImplementation(() => {
      const outgoing = new Writable({
        write(chunk, _encoding, done) { chunks.push(chunk); done(); }
      });
      outgoing.once('finish', () => {
        const response = Readable.from([Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload))]);
        outgoing.emit('response', Object.assign(response, { statusCode }));
      });
      return outgoing as unknown as import('node:http').ClientRequest;
    });
    return chunks;
  }

  beforeEach(async () => {
    env.PROCEDURE_MEETING_TRANSCRIBE_ENABLED = true;
    requestMock.mockReset();
    directory = await mkdtemp(join(tmpdir(), 'procedure-meeting-adapter-test-'));
    audioPath = join(directory, 'recording.webm');
    await writeFile(audioPath, recording);
  });
  afterEach(async () => {
    env.PROCEDURE_MEETING_TRANSCRIBE_ENABLED = enabled;
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it('sends authenticated multipart audio with procedure hints and a 35-minute deadline', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const chunks = respond(200, { text: '<spk:0> 発言', model: 'nemotron-3.5-transcribe' });
    await expect(transcribeProcedureMeeting({ audioPath, audioBytes: recording.length, mimeType: 'audio/webm' }, new AbortController().signal))
      .resolves.toBe('<spk:0> 発言');
    expect(timeout).toHaveBeenCalledWith(35 * 60_000);
    const [url, options] = requestMock.mock.calls[0] as unknown as [URL, import('node:http').RequestOptions];
    expect(url.toString()).toBe('http://dgx.test:38081/v1/audio/meeting-transcriptions');
    expect(options).toMatchObject({
      method: 'POST',
      headers: {
        'X-LLM-Token': 'test-llm-token',
        'Content-Type': expect.stringMatching(/^multipart\/form-data; boundary=/),
        'Content-Length': Buffer.concat(chunks).length
      },
      signal: expect.any(AbortSignal)
    });
    const body = Buffer.concat(chunks);
    expect(body.includes(recording)).toBe(true);
    expect(body.toString()).toContain('name="file"; filename="audio"\r\nContent-Type: audio/webm');
    expect(body.toString()).toContain(`name="prompt"\r\n\r\n${PROCEDURE_SPEECH_HINTS['procedure-assembly']}`);
  });

  it.each([
    [503, 'meeting_transcribe_busy', 'meeting_transcribe_busy', true],
    [503, 'meeting_transcribe_unavailable', 'meeting_transcribe_unavailable', true],
    [503, 'meeting_transcribe_disabled', 'meeting_transcribe_disabled', false],
    [504, 'meeting_transcribe_timeout', 'meeting_transcribe_timeout', true],
    [400, 'meeting_transcribe_busy', 'meeting_transcribe_failed', false],
    [500, 'private-upstream-code', 'meeting_transcribe_failed', true]
  ])('maps DGX HTTP %d and code %s to %s (retryable %s)', async (status, upstream, code, retryable) => {
    respond(status, { error: { code: upstream, message: 'private upstream detail' } });
    await expect(transcribeProcedureMeeting({ audioPath, audioBytes: recording.length, mimeType: 'audio/webm' }, new AbortController().signal))
      .rejects.toMatchObject({ code, message: code, retryable });
  });

  it.each([[403, false], [502, true]])('classifies non-JSON HTTP %d (retryable %s)', async (status, retryable) => {
    respond(status, '<html>proxy response</html>');
    await expect(transcribeProcedureMeeting({ audioPath, audioBytes: recording.length, mimeType: 'audio/webm' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'meeting_transcribe_failed', retryable });
  });
});
