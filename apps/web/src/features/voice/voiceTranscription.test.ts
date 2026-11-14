import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockVoiceRecording } from './voiceRecording.test-support';
import { disposeVoiceSession, startVoiceTranscription, type VoiceSession } from './voiceTranscription';

vi.mock('../../api/domains/assembly', () => ({
  getAssemblyProcedureSpeechToTextAvailability: vi.fn().mockResolvedValue(true),
  transcribeAssemblyProcedureDictation: vi.fn().mockResolvedValue({ text: '訓練' })
}));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('voice recording options', () => {
  it('waits for speech, then stops after 1.2 seconds of silence and releases resources', async () => {
    vi.useFakeTimers();
    const media = mockVoiceRecording();
    const session: VoiceSession = { abort: new AbortController() };
    const onRecording = vi.fn();
    const onLevel = vi.fn();
    const onTranscript = vi.fn();
    await startVoiceTranscription(session, () => !session.abort.signal.aborted, vi.fn(), onTranscript, vi.fn(), undefined, { silenceStopMs: 1200, onRecording, onLevel });
    await vi.advanceTimersByTimeAsync(2000);
    expect(media.recorder.state).toBe('recording');
    media.setAmplitude(0.1);
    await vi.advanceTimersByTimeAsync(100);
    media.setAmplitude(0);
    await vi.advanceTimersByTimeAsync(1100);
    expect(media.recorder.state).toBe('recording');
    await vi.advanceTimersByTimeAsync(100);
    expect(onTranscript).toHaveBeenCalledWith('訓練');
    expect(onRecording).toHaveBeenCalledWith('USB microphone');
    expect(onLevel).toHaveBeenCalledWith(expect.closeTo(0.8), 2);
    expect(media.stopTrack).toHaveBeenCalled();
    expect(media.closeContext).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the existing 60 second limit without opting into monitoring', async () => {
    vi.useFakeTimers();
    const media = mockVoiceRecording();
    const session: VoiceSession = { abort: new AbortController() };
    await startVoiceTranscription(session, () => true, vi.fn(), vi.fn(), vi.fn());
    await vi.advanceTimersByTimeAsync(59000);
    expect(media.recorder.state).toBe('recording');
    await vi.advanceTimersByTimeAsync(1000);
    expect(media.recorder.state).toBe('inactive');
    expect(media.closeContext).not.toHaveBeenCalled();
  });

  it('disposes recording and requests the default microphone for each new session', async () => {
    const media = mockVoiceRecording();
    for (let index = 0; index < 2; index++) {
      const session: VoiceSession = { abort: new AbortController() };
      const onTranscript = vi.fn();
      await startVoiceTranscription(session, () => !session.abort.signal.aborted, vi.fn(), onTranscript, vi.fn(), undefined, { silenceStopMs: 1200 });
      disposeVoiceSession(session);
      expect(onTranscript).not.toHaveBeenCalled();
    }
    expect(media.getUserMedia.mock.calls).toEqual([[{ audio: true }], [{ audio: true }]]);
    expect(media.closeContext).toHaveBeenCalledTimes(2);
    expect(media.stopTrack).toHaveBeenCalled();
  });
});
