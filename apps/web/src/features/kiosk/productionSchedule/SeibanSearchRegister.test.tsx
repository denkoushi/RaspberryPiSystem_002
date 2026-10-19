import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAssemblyProcedureSpeechToTextAvailability, transcribeAssemblyProcedureDictation } from '../../../api/domains/assembly';
import { PlanningBoardSeibanDrawer } from '../grindingPlanningBoard/PlanningBoardSeibanDrawer';

import { SeibanSearchRegister } from './SeibanSearchRegister';

import type { SeibanSearchRegisterProps } from './SeibanSearchRegister';

vi.mock('../../../api/domains/assembly', () => ({ getAssemblyProcedureSpeechToTextAvailability: vi.fn(), transcribeAssemblyProcedureDictation: vi.fn() }));
const availability = vi.mocked(getAssemblyProcedureSpeechToTextAvailability);
const transcribe = vi.mocked(transcribeAssemblyProcedureDictation);
const stopTrack = vi.fn();
const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
const getUserMedia = vi.fn();
const stt = vi.fn();
class FakeRecorder {
  static last: FakeRecorder;
  static isTypeSupported = vi.fn().mockReturnValue(true);
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { FakeRecorder.last = this; }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio'], { type: this.mimeType }) });
    this.onstop?.();
  }
}
const onRegister = vi.fn();
const onClearError = vi.fn();
const onInputFocus = vi.fn();
function Harness(props: Partial<SeibanSearchRegisterProps>) {
  const [value, setValue] = useState('EXISTING-1');
  return <SeibanSearchRegister value={value} onChange={setValue} onRegister={onRegister} onClearError={onClearError} onInputFocus={onInputFocus} inputPlaceholder="製番" inputClassName="min-w-0 flex-1" keyboardButtonClassName="" registerButtonClassName="" {...props} />;
}
async function record() {
  fireEvent.click(screen.getByRole('button', { name: '音声で入力' }));
  await waitFor(() => expect(FakeRecorder.last.state).toBe('recording'));
  const stop = screen.getByRole('button', { name: '止める' });
  expect(stop).toHaveAttribute('aria-pressed', 'true');
  expect(stop).toHaveClass('h-11', 'w-11', 'shrink-0', 'bg-red-600');
  expect(stop).toHaveTextContent('');
  fireEvent.click(stop);
}
beforeEach(() => {
  vi.clearAllMocks();
  availability.mockResolvedValue(false);
  transcribe.mockReset().mockResolvedValue({ text: 'にーろくのいちぜろよんいち' });
  getUserMedia.mockReset().mockResolvedValue(stream);
  stt.mockReset().mockResolvedValue({ ok: true, json: async () => ({ text: 'にーろくの いちぜろよんいち' }) });
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('fetch', stt);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('SeibanSearchRegister voice input', () => {
  it('is opt-in and makes no requests on mount', () => {
    const view = render(<Harness />);
    expect(screen.queryByRole('button', { name: '音声で入力' })).not.toBeInTheDocument();
    view.rerender(<Harness showVoiceButton />);
    expect(screen.getByRole('button', { name: '音声で入力' })).toBeInTheDocument();
    expect(availability).not.toHaveBeenCalled(); expect(getUserMedia).not.toHaveBeenCalled();
    expect(stt).not.toHaveBeenCalled(); expect(transcribe).not.toHaveBeenCalled();
  });
  it.each([false, true])('fills the input without registering (API=%s)', async api => {
    availability.mockResolvedValue(api);
    render(<Harness showVoiceButton />); await record();
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('26-1041'));
    expect(onRegister).not.toHaveBeenCalled(); expect(onClearError).toHaveBeenCalledOnce();
    expect(onInputFocus).toHaveBeenCalled(); expect(stopTrack).toHaveBeenCalled();
    expect(api ? transcribe : stt).toHaveBeenCalledOnce();
  });
  it.each(['ご視聴ありがとうございました。', '', '何かの文章'])('keeps the value for silence or invalid text: %s', async text => {
    stt.mockResolvedValue({ ok: true, json: async () => ({ text }) });
    render(<Harness showVoiceButton />); await record();
    expect(await screen.findByRole('status')).toHaveTextContent('聞き取れませんでした');
    expect(screen.getByRole('textbox')).toHaveValue('EXISTING-1');
    expect(onRegister).not.toHaveBeenCalled(); expect(onClearError).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'MANUAL-2' } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it.each(['denied', 'unavailable'])('reports microphone %s', async reason => {
    if (reason === 'denied') getUserMedia.mockRejectedValue(new Error('denied'));
    else Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    render(<Harness showVoiceButton />);
    fireEvent.click(screen.getByRole('button', { name: '音声で入力' }));
    expect(await screen.findByRole('status')).toHaveTextContent('マイクを使えません');
    expect(screen.getByRole('textbox')).toHaveValue('EXISTING-1');
    expect(screen.getByRole('button', { name: '音声で入力' })).toBeEnabled();
  });
  it('reports transcription failure and clears the message on restart', async () => {
    stt.mockRejectedValue(new Error('offline'));
    render(<Harness showVoiceButton />); await record();
    expect(await screen.findByRole('status')).toHaveTextContent('音声入力に失敗しました');
    expect(screen.getByRole('textbox')).toHaveValue('EXISTING-1');
    fireEvent.click(screen.getByRole('button', { name: '音声で入力' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await waitFor(() => expect(FakeRecorder.last.state).toBe('recording'));
  });
  it('disables the microphone with the input', () => {
    render(<Harness showVoiceButton inputDisabled />);
    expect(screen.getByRole('button', { name: '音声で入力' })).toBeDisabled();
  });
  it.each(['unmount', 'disable'])('stops recording on %s', async action => {
    const view = render(<Harness showVoiceButton />);
    fireEvent.click(screen.getByRole('button', { name: '音声で入力' }));
    await waitFor(() => expect(FakeRecorder.last.state).toBe('recording'));
    if (action === 'unmount') view.unmount(); else view.rerender(<Harness showVoiceButton inputDisabled />);
    expect(stopTrack).toHaveBeenCalled(); expect(FakeRecorder.last.state).toBe('inactive');
    expect(stt).not.toHaveBeenCalled();
  });
  it('disables processing and never overwrites a manual edit with a late result', async () => {
    let resolve!: (value: unknown) => void;
    stt.mockReturnValue(new Promise(done => { resolve = done; }));
    render(<Harness showVoiceButton />); await record();
    await waitFor(() => expect(stt).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: '音声で入力' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '音声で入力' })).toHaveAttribute('aria-busy', 'true');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'MANUAL-2' } });
    await act(async () => resolve({ ok: true, json: async () => ({ text: '26の1041' }) }));
    expect(screen.getByRole('textbox')).toHaveValue('MANUAL-2');
    expect(stt.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('stops late microphone tracks after unmount', async () => {
    let resolve!: (value: MediaStream) => void;
    getUserMedia.mockReturnValue(new Promise(done => { resolve = done; }));
    const view = render(<Harness showVoiceButton />);
    fireEvent.click(screen.getByRole('button', { name: '音声で入力' })); view.unmount();
    await act(async () => resolve(stream));
    expect(stopTrack).toHaveBeenCalled(); expect(stt).not.toHaveBeenCalled();
  });
  it('switches the planning board tenkey target from machine to seiban', async () => {
    render(<PlanningBoardSeibanDrawer isOpen registeredFseibans={[]} selectedFseibans={new Set()} onClose={vi.fn()} onRegister={onRegister} onRegisterMany={vi.fn()} onRemove={vi.fn()} onToggle={vi.fn()} onOpenDueDetail={vi.fn()} onClear={vi.fn()} onMove={vi.fn()} showCompletedCandidates={false} onShowCompletedCandidatesChange={vi.fn()} />);
    const machine = screen.getByRole('button', { name: '機種名数字検索値' });
    fireEvent.click(machine);
    expect(machine).toHaveAttribute('aria-pressed', 'true');
    await record();
    await waitFor(() => expect(screen.getByRole('searchbox', { name: '製番を検索' })).toHaveValue('26-1041'));
    expect(machine).toHaveAttribute('aria-pressed', 'false');
    expect(onRegister).not.toHaveBeenCalled();
  });
});
