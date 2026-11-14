import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { transcribeAssemblyProcedureDictation } from '../../api/domains/assembly';
import { mockVoiceRecording } from '../../features/voice/voiceRecording.test-support';

import HermesChatPanel from './HermesChatPanel';
import { useHermesVoiceInput } from './useHermesVoiceInput';

vi.mock('../../api/domains/assembly', () => ({
  getAssemblyProcedureSpeechToTextAvailability: vi.fn().mockResolvedValue(true),
  transcribeAssemblyProcedureDictation: vi.fn()
}));

function Harness({ onTranscript = vi.fn() }: { onTranscript?: (text: string) => void }) {
  const [draft, setDraft] = useState('下書き');
  return <HermesChatPanel draft={draft} messages={[]} isBusy={false} error={null} authRequired={null}
    onDraftChange={setDraft} onSend={vi.fn()} onReset={vi.fn()} onClose={vi.fn()}
    onVoiceTranscript={text => { setDraft(current => `${current} ${text}`); onTranscript(text); }} />;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('Hermes microphone', () => {
  beforeEach(() => {
    const nativeQuerySelector = Element.prototype.querySelector;
    vi.spyOn(Element.prototype, 'querySelector').mockImplementation(function (selector: string) {
      if (selector.includes('data-cs-message-list') && selector.includes('last-of-type')) return null;
      return nativeQuerySelector.call(this, selector);
    });
  });
  it('records, stops manually, disables processing and appends the transcript without sending', async () => {
    const media = mockVoiceRecording();
    let resolve!: (result: { text: string }) => void;
    vi.mocked(transcribeAssemblyProcedureDictation).mockReturnValue(new Promise(done => { resolve = done; }));
    const transcript = vi.fn();
    render(<Harness onTranscript={transcript} />);
    const microphone = screen.getByRole('button', { name: '声で入力' });
    expect(microphone.parentElement).toHaveClass('cs-message-input__tools');
    expect(microphone.parentElement?.querySelector('.cs-button--send')).toBeTruthy();
    fireEvent.click(microphone);
    expect(screen.getByRole('button', { name: '聞き取りを止める' })).toBeEnabled();
    expect(await screen.findByText('USB microphone')).toBeInTheDocument();
    expect(document.querySelectorAll('.hermes-chat-panel__voice-bars i')).toHaveLength(7);
    expect(document.querySelector('[contenteditable]')).toHaveAttribute('contenteditable', 'false');
    fireEvent.click(screen.getByRole('button', { name: '聞き取りを止める' }));
    expect(screen.getByRole('button', { name: '文字にしています' })).toBeDisabled();
    expect(document.querySelector('[data-placeholder]')).toHaveAttribute('data-placeholder', '文字にしています…');
    await act(async () => resolve({ text: '追加の相談' }));
    expect(screen.getByRole('button', { name: '声で入力' })).toBeEnabled();
    expect(document.querySelector('[contenteditable]')).toHaveTextContent('下書き 追加の相談');
    expect(transcript).toHaveBeenCalledWith('追加の相談');
    expect(media.stopTrack).toHaveBeenCalled();
    expect(media.closeContext).toHaveBeenCalledOnce();
  });

  it.each(['recording', 'processing'])('disposes %s when the panel closes', async phase => {
    const media = mockVoiceRecording();
    let resolve!: (result: { text: string }) => void;
    vi.mocked(transcribeAssemblyProcedureDictation).mockReturnValue(new Promise(done => { resolve = done; }));
    const transcript = vi.fn();
    const { unmount } = render(<Harness onTranscript={transcript} />);
    fireEvent.click(screen.getByRole('button', { name: '声で入力' }));
    await screen.findByText('USB microphone');
    if (phase === 'processing') {
      fireEvent.click(screen.getByRole('button', { name: '聞き取りを止める' }));
      await waitFor(() => expect(transcribeAssemblyProcedureDictation).toHaveBeenCalled());
    }
    unmount();
    await act(async () => resolve({ text: '閉じた後の結果' }));
    expect(transcript).not.toHaveBeenCalled();
    expect(media.recorder.state).toBe('inactive');
    expect(media.stopTrack).toHaveBeenCalled();
    expect(media.closeContext).toHaveBeenCalledOnce();
    if (phase === 'processing') expect(vi.mocked(transcribeAssemblyProcedureDictation).mock.calls[0][1]?.aborted).toBe(true);
  });

  it('shows microphone errors in the existing status row', async () => {
    const media = mockVoiceRecording();
    media.getUserMedia.mockRejectedValue(new Error('denied'));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '声で入力' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('マイクを使えません');
    expect(screen.getByRole('alert')).toHaveClass('hermes-chat-panel__status');
  });

  it('cancels a pending microphone request and releases the stream when permission arrives', async () => {
    const media = mockVoiceRecording();
    const stream = await media.getUserMedia();
    let grant!: (value: typeof stream) => void;
    media.getUserMedia.mockReturnValue(new Promise(done => { grant = done; }));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '声で入力' }));
    fireEvent.click(screen.getByRole('button', { name: '聞き取りを止める' }));
    await act(async () => grant(stream));
    expect(screen.getByRole('button', { name: '声で入力' })).toBeEnabled();
    expect(media.stopTrack).toHaveBeenCalledOnce();
    expect(transcribeAssemblyProcedureDictation).not.toHaveBeenCalled();
  });

  it.each(['recording', 'processing'])('shares the microphone between entry points during %s', async phase => {
    const media = mockVoiceRecording();
    vi.mocked(transcribeAssemblyProcedureDictation).mockReturnValue(new Promise(() => undefined));
    const first = renderHook(() => useHermesVoiceInput(true, vi.fn()));
    const second = renderHook(() => useHermesVoiceInput(true, vi.fn()));
    await act(async () => first.result.current.start());
    if (phase === 'processing') await act(async () => first.result.current.stop());
    await act(async () => second.result.current.start());
    expect(media.getUserMedia).toHaveBeenCalledOnce();
    expect(second.result.current.state).toBe('idle');
    act(() => first.result.current.cancel());
    await act(async () => second.result.current.start());
    expect(media.getUserMedia).toHaveBeenCalledTimes(2);
    expect(second.result.current.state).toBe('recording');
    second.unmount();
    expect(media.recorder.state).toBe('inactive');
    expect(media.closeContext).toHaveBeenCalledTimes(2);
  });

  it('renders local navigation bubbles with a microphone marker in the consultation list', () => {
    render(<HermesChatPanel mode="consultations" messages={[
      { id: 'voice-user', role: 'user', content: 'キット、訓練', localOnly: true, voice: true },
      { id: 'voice-answer', role: 'assistant', content: '組立 > 訓練 を開きました。', localOnly: true }
    ]} draft="" isBusy={false} error={null} authRequired={null} onDraftChange={vi.fn()} onSend={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('キット、訓練').querySelector('svg')).toBeTruthy();
    expect(screen.getByText('組立 > 訓練 を開きました。')).toBeInTheDocument();
  });

  it('does not show a microphone without a composer', () => {
    render(<HermesChatPanel composerVisible={false} onVoiceTranscript={vi.fn()} draft="" messages={[]} isBusy={false} error={null} authRequired={null} onDraftChange={vi.fn()} onSend={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '声で入力' })).not.toBeInTheDocument();
  });
});
