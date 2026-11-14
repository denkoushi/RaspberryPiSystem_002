import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { transcribeAssemblyProcedureDictation } from '../../api/domains/assembly';
import { mockVoiceRecording } from '../../features/voice/voiceRecording.test-support';

import { useHermesHoldVoice } from './useHermesHoldVoice';

vi.mock('../../api/domains/assembly', () => ({
  getAssemblyProcedureSpeechToTextAvailability: vi.fn().mockResolvedValue(true),
  transcribeAssemblyProcedureDictation: vi.fn()
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('Hermes hold recording lifecycle', () => {
  it('finishes the previous recording on a second press without opening another microphone', async () => {
    vi.useFakeTimers();
    const media = mockVoiceRecording();
    let finish!: (result: { text: string }) => void;
    vi.mocked(transcribeAssemblyProcedureDictation).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const onTranscript = vi.fn().mockReturnValue(true);
    const { result } = renderHook(() => useHermesHoldVoice(true, onTranscript));
    await act(async () => result.current.press());
    await act(async () => vi.advanceTimersByTime(400));
    act(() => { result.current.release(); });
    await act(async () => vi.advanceTimersByTime(100));
    const stop = vi.spyOn(media.recorder, 'stop');
    await act(async () => result.current.press());
    expect(stop).toHaveBeenCalledOnce();
    expect(media.getUserMedia).toHaveBeenCalledOnce();
    expect(result.current.state).toBe('processing');
    // A short second press must not abort the preceding transcription.
    act(() => { result.current.release(); });
    await act(async () => finish({ text: '訓練' }));
    expect(onTranscript).toHaveBeenCalledExactlyOnceWith('訓練');
    await act(async () => vi.advanceTimersByTime(350));
    expect(stop).toHaveBeenCalledOnce();
    expect(media.closeContext).toHaveBeenCalledOnce();
  });

  it.each(['blur', 'disable', 'unmount'])('disposes recording and the pending stop on %s', async action => {
    vi.useFakeTimers();
    const media = mockVoiceRecording();
    const onTranscript = vi.fn();
    const { result, rerender, unmount } = renderHook(({ enabled }) => useHermesHoldVoice(enabled, onTranscript), { initialProps: { enabled: true } });
    await act(async () => result.current.press());
    await act(async () => vi.advanceTimersByTime(400));
    act(() => { result.current.release(); });
    const stop = vi.spyOn(media.recorder, 'stop');
    if (action === 'blur') act(() => { window.dispatchEvent(new Event('blur')); });
    else if (action === 'disable') rerender({ enabled: false });
    else unmount();
    await act(async () => vi.advanceTimersByTime(350));
    expect(stop).toHaveBeenCalledOnce();
    expect(media.stopTrack).toHaveBeenCalled();
    expect(media.closeContext).toHaveBeenCalledOnce();
    expect(transcribeAssemblyProcedureDictation).not.toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it('discards a short press even when microphone permission arrives later', async () => {
    vi.useFakeTimers();
    const media = mockVoiceRecording();
    const stream = await media.getUserMedia();
    let grant!: (value: typeof stream) => void;
    media.getUserMedia.mockClear().mockReturnValue(new Promise(resolve => { grant = resolve; }));
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useHermesHoldVoice(true, onTranscript));
    act(() => result.current.press());
    expect(media.getUserMedia).toHaveBeenCalledOnce();
    act(() => { result.current.release(); });
    await act(async () => grant(stream));
    await act(async () => vi.advanceTimersByTime(750));
    expect(media.recorder).toBeUndefined();
    expect(media.stopTrack).toHaveBeenCalledOnce();
    expect(transcribeAssemblyProcedureDictation).not.toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
    expect(result.current.state).toBeNull();
  });

  it('keeps recording through silence until release and cleans up an empty transcript', async () => {
    vi.useFakeTimers();
    const media = mockVoiceRecording();
    vi.mocked(transcribeAssemblyProcedureDictation).mockResolvedValue({ text: '' });
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useHermesHoldVoice(true, onTranscript));
    await act(async () => result.current.press());
    media.setAmplitude(0.1);
    await act(async () => vi.advanceTimersByTime(100));
    media.setAmplitude(0);
    await act(async () => vi.advanceTimersByTime(2000));
    expect(media.recorder.state).toBe('recording');
    act(() => { result.current.release(); });
    await act(async () => vi.advanceTimersByTime(350));
    expect(media.recorder.state).toBe('inactive');
    expect(media.stopTrack).toHaveBeenCalled();
    expect(media.closeContext).toHaveBeenCalledOnce();
    expect(onTranscript).not.toHaveBeenCalled();
    expect(result.current.state).toBe('error');
    await act(async () => vi.advanceTimersByTime(900));
    expect(vi.getTimerCount()).toBe(0);
  });
});
