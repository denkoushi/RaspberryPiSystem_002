import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingTranscriptionError } from '../../inference/adapters/http-meeting-transcription.adapter.js';
import { formatMeetingTranscript, PROCEDURE_MEETING_RETENTION_MS, ProcedureMeetingTranscriptionWorker } from '../procedure-meeting-transcription.worker.js';

const { jobs } = vi.hoisted(() => ({
  jobs: { findFirst: vi.fn(), updateManyAndReturn: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() }
}));
vi.mock('../../../lib/prisma.js', () => {
  const client = { procedureMeetingTranscriptionJob: jobs, $executeRaw: vi.fn() };
  return { prisma: { ...client, $transaction: (fn: (tx: typeof client) => unknown) => fn(client) } };
});

describe('meeting speaker formatting', () => {
  it('joins adjacent turns for the same speaker and preserves the order of speaker changes', () => {
    expect(formatMeetingTranscript(' <spk:0> 棚です。 <spk:0> 次です。 <spk:2> はい。\n 続けます。 <spk:0> 了解。 '))
      .toBe('話者1: 棚です。 次です。\n話者3: はい。 続けます。\n話者1: 了解。');
  });

  it('keeps untagged speech and skips empty turns', () => {
    expect(formatMeetingTranscript('冒頭 <spk:1> <spk:0> 続き')).toBe('話者1: 冒頭 続き');
    expect(formatMeetingTranscript('<spk:0>  <spk:1>')).toBe('');
  });

  it('preserves all utterances in order and merges precisely the adjacent equal speakers', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 20 })), speakers => {
      const lines = formatMeetingTranscript(speakers.map((speaker, index) => `<spk:${speaker}> 発言${index}`).join(' '));
      expect(lines.match(/発言\d+/g) ?? []).toEqual(speakers.map((_speaker, index) => `発言${index}`));
      expect(lines.match(/話者\d+:/g) ?? []).toEqual(speakers.filter((speaker, index) => speaker !== speakers[index - 1]).map(speaker => `話者${speaker + 1}:`));
    }));
  });
});

describe('meeting transcription worker', () => {
  let directory: string;
  let audioPath: string;
  const jobId = 'job';
  const transcribe = vi.fn();

  function claim(attempts = 1, createdAt = new Date()) {
    jobs.updateManyAndReturn.mockResolvedValue([{
      id: jobId, audioPath, audioBytes: 10, mimeType: 'audio/webm', attempts, createdAt,
      leaseExpiresAt: new Date(Date.now() + 60_000)
    }]);
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    directory = await mkdtemp(join(tmpdir(), 'procedure-meeting-test-'));
    vi.stubEnv('PROCEDURE_MEETING_AUDIO_DIR', directory);
    audioPath = join(directory, 'audio.webm');
    await writeFile(audioPath, 'test audio');
    jobs.findMany.mockResolvedValue([]);
    jobs.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: jobId });
    jobs.updateMany.mockResolvedValue({ count: 1 });
    claim();
    transcribe.mockResolvedValue('<spk:1> 発言');
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it('stores the formatted text and removes the successful job audio', async () => {
    await new ProcedureMeetingTranscriptionWorker(transcribe).tick(new AbortController().signal);
    expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({ audioPath, audioBytes: 10, mimeType: 'audio/webm' }), expect.any(AbortSignal));
    expect(jobs.updateMany).toHaveBeenCalledWith({
      where: { id: jobId, status: 'RUNNING', attempts: 1, leaseExpiresAt: { gt: expect.any(Date) } },
      data: { status: 'SUCCEEDED', resultText: '話者2: 発言', errorCode: null, leaseExpiresAt: null }
    });
    await expect(access(audioPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['meeting_transcribe_disabled', 'meeting_transcribe_too_large', 'meeting_transcribe_too_long', 'meeting_transcribe_bad_request', 'meeting_transcribe_failed'])('fails %s and removes audio', async code => {
    transcribe.mockRejectedValue(new MeetingTranscriptionError(code));
    await new ProcedureMeetingTranscriptionWorker(transcribe).tick(new AbortController().signal);
    expect(jobs.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'FAILED', errorCode: code, leaseExpiresAt: null } }));
    await expect(access(audioPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    new MeetingTranscriptionError('meeting_transcribe_busy'),
    new MeetingTranscriptionError('meeting_transcribe_insufficient_memory'),
    new MeetingTranscriptionError('meeting_transcribe_unavailable'),
    new MeetingTranscriptionError('meeting_transcribe_timeout'),
    new MeetingTranscriptionError('meeting_transcribe_failed', true),
    Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }),
    Object.assign(new Error('broken pipe'), { code: 'EPIPE' }),
    Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' })
  ])('defers a temporary failure and keeps audio (%s)', async error => {
    vi.useFakeTimers();
    transcribe.mockRejectedValue(error);
    await new ProcedureMeetingTranscriptionWorker(transcribe).tick(new AbortController().signal);
    expect(jobs.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'QUEUED', retryAt: new Date(Date.now() + 120_000), leaseExpiresAt: null }
    }));
    await expect(access(audioPath)).resolves.toBeUndefined();
  });

  it.each([[2, 5], [3, 10], [4, 15], [7, 15]])('defers attempt %d for %d minutes', async (attempts, minutes) => {
    vi.useFakeTimers();
    claim(attempts);
    transcribe.mockRejectedValue(new MeetingTranscriptionError('meeting_transcribe_busy'));
    await new ProcedureMeetingTranscriptionWorker(transcribe).tick(new AbortController().signal);
    expect(jobs.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'QUEUED', retryAt: new Date(Date.now() + minutes * 60_000), leaseExpiresAt: null }
    }));
  });

  it.each(['eighth attempt', 'retention deadline'])('fails and removes audio at the %s', async limit => {
    if (limit === 'eighth attempt') claim(8);
    else claim(1, new Date(Date.now() - PROCEDURE_MEETING_RETENTION_MS + 60_000));
    transcribe.mockRejectedValue(new MeetingTranscriptionError('meeting_transcribe_busy'));
    await new ProcedureMeetingTranscriptionWorker(transcribe).tick(new AbortController().signal);
    expect(jobs.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'FAILED', errorCode: 'meeting_transcribe_busy', leaseExpiresAt: null }
    }));
    await expect(access(audioPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['recovers', 'expires', 'loses ownership'])('handles a heartbeat DB exception and then %s', async outcome => {
    vi.useFakeTimers();
    claim();
    const time = Date.now();
    let finish!: (text: string) => void;
    let signal!: AbortSignal;
    transcribe.mockImplementation((_audio, inputSignal: AbortSignal) => {
      signal = inputSignal;
      return new Promise<string>((resolve, reject) => {
        finish = resolve;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    jobs.updateMany.mockRejectedValueOnce(new Error('transient DB error'));
    if (outcome === 'expires') jobs.updateMany.mockRejectedValue(new Error('DB unavailable'));
    if (outcome === 'loses ownership') jobs.updateMany.mockResolvedValueOnce({ count: 0 });
    const tick = new ProcedureMeetingTranscriptionWorker(transcribe).tick(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(signal.aborted).toBe(false);
    if (outcome === 'recovers') {
      await vi.advanceTimersByTimeAsync(45_000);
      expect(signal.aborted).toBe(false);
      finish('<spk:0> 発言');
    } else {
      const abortedAt = outcome === 'expires' ? 60_000 : 30_000;
      await vi.advanceTimersByTimeAsync(abortedAt - (Date.now() - time) - 1);
      expect(signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signal.aborted).toBe(true);
    }
    await tick;
    expect(jobs.updateMany.mock.calls.some(([args]) => args.data.status === 'SUCCEEDED')).toBe(outcome === 'recovers');
  });

  it('purges expired rows and audio', async () => {
    jobs.findMany.mockResolvedValue([{ id: jobId, audioPath }]);
    await new ProcedureMeetingTranscriptionWorker(transcribe).cleanup();
    expect(jobs.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lte: expect.any(Date) }, status: { not: 'RUNNING' }, audioPath: null }
    });
    expect(transcribe).not.toHaveBeenCalled();
    await expect(access(audioPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('requeues on shutdown and keeps the audio without consuming an attempt', async () => {
    const shutdown = new AbortController();
    transcribe.mockImplementation(async () => { shutdown.abort(); throw new Error('shutdown'); });
    await new ProcedureMeetingTranscriptionWorker(transcribe).tick(shutdown.signal);
    expect(jobs.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'QUEUED', attempts: { decrement: 1 }, leaseExpiresAt: null }
    }));
    await expect(access(audioPath)).resolves.toBeUndefined();
  });
});
