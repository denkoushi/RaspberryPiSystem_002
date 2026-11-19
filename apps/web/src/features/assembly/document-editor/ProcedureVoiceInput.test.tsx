import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getAssemblyProcedureMeeting, getAssemblyProcedureMeetingAvailability, getAssemblyProcedureSpeechToTextAvailability,
  rewriteAssemblyProcedureDictation, submitAssemblyProcedureMeeting, transcribeAssemblyProcedureDictation
} from '../../../api/domains/assembly';
import { rewriteAssemblyProcedureDictation as rewriteDictationRequest } from '../../../api/domains/assembly/dictation';
import { useLocalLlmAvailability } from '../../../api/hooks/local-llm';
import { api } from '../../../api/http';

import { splitMeetingText } from './assemblyDocumentEditorDraft';
import { AssemblyProcedureDocumentEditorInspector } from './AssemblyProcedureDocumentEditorInspector';
import { PROCEDURE_DICTATION_REWRITE_TIMEOUT_MS, PROCEDURE_WHISPER_BASE_URL, useProcedureMeetingInput } from './useProcedureVoiceInput';

import type { OverlayTextElement } from '@raspi-system/shared-types';

vi.mock('../../../api/domains/assembly', () => ({
  rewriteAssemblyProcedureDictation: vi.fn(), getAssemblyProcedureSpeechToTextAvailability: vi.fn(), transcribeAssemblyProcedureDictation: vi.fn(),
  getAssemblyProcedureMeetingAvailability: vi.fn(), submitAssemblyProcedureMeeting: vi.fn(), getAssemblyProcedureMeeting: vi.fn()
}));
const meetingAvailability = vi.mocked(getAssemblyProcedureMeetingAvailability);
const submitMeeting = vi.mocked(submitAssemblyProcedureMeeting);
const getMeeting = vi.mocked(getAssemblyProcedureMeeting);
const availability = vi.mocked(getAssemblyProcedureSpeechToTextAvailability);
const transcribe = vi.mocked(transcribeAssemblyProcedureDictation);
const rewrite = vi.mocked(rewriteAssemblyProcedureDictation);
const stopTrack = vi.fn();
const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
const getUserMedia = vi.fn();
const stt = vi.fn();
class FakeRecorder {
  static last: FakeRecorder;
  static isTypeSupported = vi.fn().mockReturnValue(true);
  static audioSize = 5;
  options?: MediaRecorderOptions;
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_stream: MediaStream, options?: MediaRecorderOptions) { FakeRecorder.last = this; this.options = options; }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob([new Uint8Array(FakeRecorder.audioSize)], { type: this.mimeType }) });
    this.onstop?.();
  }
}
const makeElement = (text: string, id = 'one'): OverlayTextElement => ({ id, kind: 'TEXT', text, pageIndex: 0, zIndex: 0, bbox: { xRatio: 0, yRatio: 0, widthRatio: 0.4, heightRatio: 0.1 } });
const common = { onDelete: vi.fn(), onBringForward: vi.fn(), onSendBackward: vi.fn(), onBringToFront: vi.fn(), onSendToBack: vi.fn(), onRefetchTextCandidates: vi.fn() };
const documentId = '00000000-0000-4000-8000-000000000001';
function Harness({ text = '', enabled = true, saving = false, onUpdate = vi.fn(), context, documentId, holderToken, onMeetingUpdate }: { text?: string; enabled?: boolean; saving?: boolean; onUpdate?: (element: OverlayTextElement) => void; context?: string; documentId?: string; holderToken?: string; onMeetingUpdate?: (element: OverlayTextElement, overflow: string[]) => () => boolean }) {
  const [elements, setElements] = useState({ one: makeElement(text), two: makeElement('別の文章', 'two') });
  const [selected, setSelected] = useState<keyof typeof elements | null>('one');
  const [working, setBusy] = useState(false);
  const busy = saving || working;
  const element = selected ? elements[selected] : null;
  const setElement = (next: OverlayTextElement) => setElements(current => ({ ...current, [next.id]: next }));
  const meeting = useProcedureMeetingInput({
    element, enabled, disabled: false, busy, inlineEditingId: null, documentId,
    applyTranscript: (target, transcript) => {
      const original = elements[target.id as keyof typeof elements];
      const [text, ...overflow] = splitMeetingText(original.text, transcript);
      const updated = { ...original, text };
      const undo = onMeetingUpdate?.(updated, overflow);
      setElement(updated);
      return { element: updated, undo: () => {
        if (undo && !undo()) return false;
        setElement(original);
        return true;
      } };
    }
  });
  return <>
    <button onClick={() => setSelected('two')}>選択を変える</button>
    <button onClick={() => setSelected(null)}>選択を外す</button>
    <button onClick={() => setSelected('one')}>最初の文章を選ぶ</button>
    <button onClick={() => setBusy(value => !value)}>ビジー切替</button>
    <button onClick={() => setElement(makeElement('前の文'))}>外から変える</button>
    {element ? <AssemblyProcedureDocumentEditorInspector {...common} key={element.id} element={element}
      voiceInputEnabled={enabled} voiceContext={context} documentId={documentId} holderToken={holderToken} meeting={meeting}
      busy={busy} onUpdate={next => { if (next.kind === 'TEXT') { onUpdate(next); setElement(next); } }} /> : null}
  </>;
}
async function record(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
  await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
  await waitFor(() => expect(FakeRecorder.last.state).toBe('recording'));
  fireEvent.click(screen.getByRole('button', { name: '止める' }));
}
beforeEach(() => {
    vi.mocked(useLocalLlmAvailability).mockReturnValue({ unavailable: false });
  vi.clearAllMocks();
  FakeRecorder.audioSize = 5; FakeRecorder.isTypeSupported.mockReturnValue(true);
  meetingAvailability.mockReset().mockResolvedValue(false);
  submitMeeting.mockReset().mockResolvedValue({ jobId: 'meeting-job' });
  getMeeting.mockReset().mockResolvedValue({ status: 'SUCCEEDED', text: '話者1: 発言。\n話者2: 了解。' });
  availability.mockResolvedValue(false); transcribe.mockReset().mockResolvedValue({ text: '棚' });
  getUserMedia.mockResolvedValue(stream);
  stt.mockResolvedValue({ ok: true, json: async () => ({ text: '  えーと、棚に直す  ' }) });
  rewrite.mockResolvedValue({ text: '棚に戻す。' });
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('fetch', stt);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('procedure voice input', () => {
  it.each([['話す', ''], ['続き', '既存。'], ['直す', '既存。']])('keeps %s clickable with an unavailable badge', async (label, text) => {
    vi.mocked(useLocalLlmAvailability).mockReturnValue({ unavailable: true });
    const onUpdate = vi.fn();
    render(<Harness text={text} onUpdate={onUpdate} />);
    const button = screen.getByRole('button', { name: label, exact: true });
    expect(button).toHaveAccessibleDescription('AI 未起動');
    expect(button).toHaveTextContent('!');
    fireEvent.click(button);
    await waitFor(() => expect(FakeRecorder.last.state).toBe('recording'));
    expect(screen.getByRole('button', { name: '止める' })).not.toHaveAccessibleDescription('AI 未起動');
    fireEvent.click(screen.getByRole('button', { name: '止める' }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: '戻す', exact: true })).not.toHaveAccessibleDescription('AI 未起動');
  });

  it('does nothing while off', () => {
    render(<Harness enabled={false} />);
    expect(screen.queryByRole('button', { name: '話す' })).not.toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled(); expect(stt).not.toHaveBeenCalled(); expect(rewrite).not.toHaveBeenCalled();
  });
  it.each(['', 'ここに文章を入力', '  '])('shows 話す for empty/placeholder text', text => {
    render(<Harness text={text} />);
    expect(screen.getByRole('button', { name: '話す' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '続き' })).not.toBeInTheDocument();
  });
  it('keeps the existing attribute controls while voice input is on', () => {
    render(<Harness />);
    expect(screen.getByRole('heading', { name: '文章' })).toBeInTheDocument();
    expect(screen.getByText('位置と大きさ（元ページに対する %）')).toBeInTheDocument();
  });
  it('does not write over text changed by undo during a session and returns to idle', async () => {
    let resolve!: (value: { text: string }) => void;
    rewrite.mockReturnValue(new Promise(done => { resolve = done; }));
    const onUpdate = vi.fn(); render(<Harness text="既存。" onUpdate={onUpdate} />);
    await record('続き');
    await waitFor(() => expect(rewrite).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '外から変える' }));
    resolve({ text: '棚に戻す。' });
    await waitFor(() => expect(screen.getByRole('button', { name: '続き' })).toBeInTheDocument());
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('前の文');
  });
  it('rejects an append that would exceed the text limit', async () => {
    const text = 'あ'.repeat(9998);
    const onUpdate = vi.fn(); render(<Harness text={text} onUpdate={onUpdate} />);
    await record('続き');
    expect(await screen.findByRole('alert')).toHaveTextContent('長すぎます');
    expect(onUpdate).not.toHaveBeenCalled();
  });
  it('shows 続き and 直す for existing text', () => {
    render(<Harness text="既存" />);
    expect(screen.getByRole('button', { name: '続き' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '直す' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '話す' })).not.toBeInTheDocument();
  });
  it('sends the selected document, first page and element to rewrite', async () => {
    render(<Harness text="既存。" documentId={documentId} />);
    await record('続き');
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('既存。\n棚に戻す。'));
    expect(rewrite).toHaveBeenCalledExactlyOnceWith({
      mode: 'append', spokenText: 'えーと、棚に直す', currentText: '既存。', signal: expect.any(AbortSignal),
      documentId, pageIndex: 0, elementId: 'one', originalText: '既存。',
    });
  });
  it('sends the edit token and original placeholder with a new dictation and restores it on undo', async () => {
    const originalText = 'ここに文章を入力';
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { text: '棚に戻す。' } });
    rewrite.mockImplementationOnce(rewriteDictationRequest);
    render(<Harness text={originalText} documentId={documentId} holderToken="session-token" />);
    await record('話す');
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('棚に戻す。'));
    expect(post).toHaveBeenCalledExactlyOnceWith('/assembly/procedure-documents/dictation/rewrite', {
      mode: 'new', spokenText: 'えーと、棚に直す', currentText: undefined,
      documentId, pageIndex: 0, elementId: 'one', originalText,
    }, { signal: expect.any(AbortSignal), headers: { 'x-procedure-edit-token': 'session-token' } });
    fireEvent.click(screen.getByRole('button', { name: '戻す', exact: true }));
    expect(screen.getByRole('textbox')).toHaveValue(originalText);
  });
  it.each([
    ['話す', 'new', '', '棚に戻す。'],
    ['続き', 'append', '既存。', '既存。\n棚に戻す。'],
    ['直す', 'revise', '既存。', '棚に戻す。']
  ] as const)('applies %s in one update and supports 戻す', async (label, mode, text, expected) => {
    const onUpdate = vi.fn(); render(<Harness text={text} onUpdate={onUpdate} />);
    await record(label);
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(expected));
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'one', text: expected }));
    expect(rewrite).toHaveBeenCalledExactlyOnceWith({ mode, spokenText: 'えーと、棚に直す', currentText: mode === 'new' ? undefined : text, signal: expect.any(AbortSignal) });
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: true });
    expect(stt.mock.calls[0][0]).toBe(`${PROCEDURE_WHISPER_BASE_URL}/inference`);
    const body = stt.mock.calls[0][1].body as FormData;
    expect(body.get('file')).toBeInstanceOf(Blob);
    expect(body.get('response_format')).toBe('json'); expect(body.get('language')).toBe('ja'); expect(body.get('temperature')).toBe('0');
    expect(screen.getByText('聞き取り: えーと、棚に直す')).toBeInTheDocument();
    expect(stopTrack).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '戻す', exact: true }));
    expect(screen.getByRole('textbox')).toHaveValue(text);
    expect(screen.queryByRole('button', { name: '戻す', exact: true })).not.toBeInTheDocument();
  });
  it('hides 戻す after a manual edit', async () => {
    render(<Harness />); await record('話す');
    await screen.findByRole('button', { name: '戻す', exact: true });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '手入力' } });
    expect(screen.queryByRole('button', { name: '戻す', exact: true })).not.toBeInTheDocument();
  });
  it('hides 戻す and transcript on selection change', async () => {
    render(<Harness />); await record('話す');
    await screen.findByRole('button', { name: '戻す', exact: true });
    fireEvent.click(screen.getByRole('button', { name: '選択を変える' }));
    expect(screen.queryByRole('button', { name: '戻す', exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(/聞き取り:/)).not.toBeInTheDocument();
  });
  it.each(['denied', 'unavailable'])('shows the microphone error (%s)', async reason => {
    if (reason === 'denied') getUserMedia.mockRejectedValue(new Error('denied'));
    else Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    render(<Harness />); fireEvent.click(screen.getByRole('button', { name: '話す' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('マイクを使えません');
  });
  it('cleans up recorder errors', async () => {
    render(<Harness />); fireEvent.click(screen.getByRole('button', { name: '話す' }));
    await waitFor(() => expect(FakeRecorder.last.state).toBe('recording'));
    act(() => FakeRecorder.last.onerror?.());
    expect(screen.getByRole('alert')).toHaveTextContent('マイクを使えません');
    expect(stopTrack).toHaveBeenCalled(); expect(stt).not.toHaveBeenCalled();
  });
  it.each(['network', 'status'])('shows STT unavailable (%s)', async failure => {
    if (failure === 'network') stt.mockRejectedValue(new Error('offline'));
    else stt.mockResolvedValue({ ok: false });
    const onUpdate = vi.fn(); render(<Harness onUpdate={onUpdate} />); await record('話す');
    expect(await screen.findByRole('alert')).toHaveTextContent('音声認識が動いていません');
    expect(onUpdate).not.toHaveBeenCalled(); expect(stopTrack).toHaveBeenCalled();
  });
  it('handles an empty transcript', async () => {
    stt.mockResolvedValue({ ok: true, json: async () => ({ text: '  ' }) });
    render(<Harness />); await record('話す');
    expect(await screen.findByRole('alert')).toHaveTextContent('聞き取れませんでした');
    expect(rewrite).not.toHaveBeenCalled();
  });
  it('treats the stock phrase whisper returns for silence as nothing heard', async () => {
    stt.mockResolvedValue({ ok: true, json: async () => ({ text: 'ご視聴ありがとうございました。' }) });
    const onUpdate = vi.fn(); render(<Harness text="既存。" onUpdate={onUpdate} />); await record('続き');
    expect(await screen.findByRole('alert')).toHaveTextContent('聞き取れませんでした');
    expect(rewrite).not.toHaveBeenCalled(); expect(onUpdate).not.toHaveBeenCalled();
  });
  it('stops waiting for the rewrite after the limit and keeps the recognized text', async () => {
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    rewrite.mockImplementation(({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))));
    render(<Harness text="既存。" />); await record('続き');
    await waitFor(() => expect(rewrite).toHaveBeenCalled());
    const limit = timeout.mock.calls.find(call => call[1] === PROCEDURE_DICTATION_REWRITE_TIMEOUT_MS);
    expect(limit).toBeDefined();
    await act(async () => { (limit![0] as () => void)(); });
    expect(await screen.findByRole('alert')).toHaveTextContent('そのまま入れました');
    expect(screen.getByRole('textbox')).toHaveValue('既存。\nえーと、棚に直す');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    timeout.mockRestore();
  });
  it.each([
    ['話す', '', 'えーと、棚に直す', 'そのまま入れました'],
    ['続き', '既存。', '既存。\nえーと、棚に直す', 'そのまま入れました'],
    ['直す', '既存。', '既存。', '直せませんでした']
  ])('handles rewrite failure for %s', async (label, text, expected, message) => {
    rewrite.mockRejectedValue(new Error('failed'));
    const onUpdate = vi.fn(); render(<Harness text={text} onUpdate={onUpdate} />); await record(label);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('textbox')).toHaveValue(expected);
    expect(onUpdate).toHaveBeenCalledTimes(label === '直す' ? 0 : 1);
  });
  it.each(['microphone', 'stt', 'rewrite'])('never writes after selection changes during %s', async stage => {
    let resolve: (value: never) => void = () => {};
    const pending = new Promise<never>(done => { resolve = done; });
    if (stage === 'microphone') getUserMedia.mockReturnValue(pending);
    if (stage === 'stt') stt.mockReturnValue(pending);
    if (stage === 'rewrite') rewrite.mockReturnValue(pending);
    const onUpdate = vi.fn(); render(<Harness onUpdate={onUpdate} />);
    if (stage === 'microphone') fireEvent.click(screen.getByRole('button', { name: '話す' }));
    else {
      await record('話す');
      if (stage === 'rewrite') await waitFor(() => expect(rewrite).toHaveBeenCalled());
      expect(screen.getByRole('status')).toHaveTextContent('文にしています…');
    }
    fireEvent.click(screen.getByRole('button', { name: '選択を変える' }));
    await act(async () => resolve((stage === 'microphone' ? stream : stage === 'stt' ? { ok: true, json: async () => ({ text: '棚' }) } : { text: '棚に戻す。' }) as never));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('別の文章');
    expect(stopTrack).toHaveBeenCalled();
    if (stage !== 'microphone') expect(stt.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it.each(['unmount', 'off'])('stops tracks when %s during recording', async action => {
    const view = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '話す' }));
    await waitFor(() => expect(FakeRecorder.last.state).toBe('recording'));
    if (action === 'unmount') view.unmount(); else view.rerender(<Harness enabled={false} />);
    expect(stopTrack).toHaveBeenCalled(); expect(stt).not.toHaveBeenCalled();
  });
  it('cancels while microphone permission is pending and stops late tracks', async () => {
    let resolve: (value: MediaStream) => void = () => {};
    getUserMedia.mockReturnValue(new Promise<MediaStream>(done => { resolve = done; }));
    const onUpdate = vi.fn(); render(<Harness onUpdate={onUpdate} />);
    fireEvent.click(screen.getByRole('button', { name: '話す' }));
    fireEvent.click(screen.getByRole('button', { name: '止める' }));
    await act(async () => resolve(stream));
    expect(stopTrack).toHaveBeenCalled(); expect(stt).not.toHaveBeenCalled(); expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '話す' })).toBeInTheDocument();
  });
  it('stops automatically after sixty seconds', async () => {
    vi.useFakeTimers(); render(<Harness />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '話す' })));
    expect(FakeRecorder.last.state).toBe('recording');
    await act(async () => vi.advanceTimersByTime(60000));
    expect(FakeRecorder.last.state).toBe('inactive'); expect(stopTrack).toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('棚に戻す。');
  });
});


const busy = (retryAfter?: string) => ({ isAxiosError: true, response: { status: 429, headers: { 'retry-after': retryAfter } } });
describe('procedure voice input API relay', () => {
  it.each(['procedure-assembly', 'procedure-grinding'])('forwards %s on the initial request and the 429 retry', async context => {
    vi.useFakeTimers(); availability.mockResolvedValue(true); transcribe.mockRejectedValueOnce(busy('1'));
    render(<Harness context={context} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '話す' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '止める' })));
    expect(transcribe).toHaveBeenNthCalledWith(1, expect.any(Blob), expect.any(AbortSignal), context);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(transcribe).toHaveBeenNthCalledWith(2, transcribe.mock.calls[0][0], transcribe.mock.calls[0][1], context);
    expect(screen.getByRole('textbox')).toHaveValue('棚に戻す。');
  });
  it('uses the API when available and starts recording while availability is pending', async () => {
    let resolve!: (value: boolean) => void;
    availability.mockReturnValue(new Promise(done => { resolve = done; }));
    render(<Harness />); await record('話す');
    expect(availability).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal));
    expect(transcribe).not.toHaveBeenCalled();
    await act(async () => resolve(true));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('棚に戻す。'));
    expect(transcribe).toHaveBeenCalledExactlyOnceWith(expect.any(Blob), expect.any(AbortSignal), undefined);
    expect(stt).not.toHaveBeenCalled();
  });
  it.each(['unavailable', 'failed'])('uses the unchanged device request when availability is %s', async reason => {
    if (reason === 'failed') availability.mockRejectedValue(new Error('offline'));
    render(<Harness />); await record('話す');
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('棚に戻す。'));
    expect(transcribe).not.toHaveBeenCalled();
    const body = stt.mock.calls[0][1].body as FormData;
    expect([...body.keys()]).toEqual(['file', 'response_format', 'language', 'temperature']);
    expect((body.get('file') as File).name).toBe('dictation.webm');
    expect(body.get('response_format')).toBe('json'); expect(body.get('language')).toBe('ja'); expect(body.get('temperature')).toBe('0');
  });
  it.each([true, false])('sets the bitrate and supported Opus mime (%s)', async supported => {
    FakeRecorder.isTypeSupported.mockReturnValue(supported);
    render(<Harness />); await record('話す');
    expect(FakeRecorder.isTypeSupported).toHaveBeenCalledWith('audio/webm;codecs=opus');
    expect(FakeRecorder.last.options).toEqual({ audioBitsPerSecond: 64000, ...(supported ? { mimeType: 'audio/webm;codecs=opus' } : {}) });
    await screen.findByRole('button', { name: '戻す', exact: true });
  });
  it('rejects oversized audio before calling the API', async () => {
    availability.mockResolvedValue(true); FakeRecorder.audioSize = 2_000_001;
    render(<Harness />); await record('話す');
    expect(await screen.findByRole('alert')).toHaveTextContent('長すぎます');
    expect(transcribe).not.toHaveBeenCalled(); expect(stt).not.toHaveBeenCalled(); expect(rewrite).not.toHaveBeenCalled();
  });
  it.each(['network', 'status'])('shows the existing message for API %s errors', async reason => {
    availability.mockResolvedValue(true);
    transcribe.mockRejectedValue(reason === 'network' ? new Error('network') : { isAxiosError: true, response: { status: 503 } });
    render(<Harness />); await record('話す');
    expect(await screen.findByRole('alert')).toHaveTextContent('音声認識が動いていません');
    expect(stt).not.toHaveBeenCalled();
  });
  it.each([['3', 3], [undefined, 2], ['99', 5], ['bad', 2], ['0', 2]])('retries once after Retry-After %s then succeeds', async (header, seconds) => {
    vi.useFakeTimers(); availability.mockResolvedValue(true); transcribe.mockRejectedValueOnce(busy(header));
    render(<Harness />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '話す' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '止める' })));
    expect(transcribe).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(Number(seconds) * 1000 - 1));
    expect(transcribe).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('textbox')).toHaveValue('棚に戻す。');
    expect(stt).not.toHaveBeenCalled();
  });
  it('shows 混んでいます after two 429 responses', async () => {
    vi.useFakeTimers(); availability.mockResolvedValue(true); transcribe.mockRejectedValue(busy());
    render(<Harness />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '話す' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '止める' })));
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(transcribe).toHaveBeenCalledTimes(2); expect(screen.getByRole('alert')).toHaveTextContent('混んでいます');
    expect(rewrite).not.toHaveBeenCalled();
  });
  it.each(['selection', 'unmount', 'edit'])('cancels the retry wait on %s', async action => {
    vi.useFakeTimers(); availability.mockResolvedValue(true); transcribe.mockRejectedValueOnce(busy());
    const onUpdate = vi.fn(); const view = render(<Harness onUpdate={onUpdate} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '話す' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '止める' })));
    expect(transcribe).toHaveBeenCalledTimes(1);
    if (action === 'unmount') view.unmount();
    else if (action === 'selection') fireEvent.click(screen.getByRole('button', { name: '選択を変える' }));
    else fireEvent.change(screen.getByRole('textbox'), { target: { value: '手入力' } });
    expect(transcribe.mock.calls[0][1].aborted).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(transcribe).toHaveBeenCalledTimes(1); expect(onUpdate).toHaveBeenCalledTimes(action === 'edit' ? 1 : 0);
    expect(rewrite).not.toHaveBeenCalled();
  });
});

vi.mock('../../../api/hooks/local-llm', () => ({ useLocalLlmAvailability: vi.fn(() => ({ unavailable: false })) }));

describe('procedure meeting transcription', () => {
  async function startMeeting(text = '既存。', onMeetingUpdate?: React.ComponentProps<typeof Harness>['onMeetingUpdate']) {
    vi.useFakeTimers();
    meetingAvailability.mockResolvedValue(true);
    render(<Harness text={text} onMeetingUpdate={onMeetingUpdate} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: '話し合い' }));
    await act(async () => {});
  }

  it('hides the meeting button while the feature is disabled', async () => {
    render(<Harness text="既存。" />);
    await act(async () => {});
    expect(screen.queryByRole('button', { name: '話し合い' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '続き' })).toBeInTheDocument();
  });

  it('shows recording and processing, polls every five seconds, appends speakers, and restores', async () => {
    vi.mocked(useLocalLlmAvailability).mockReturnValue({ unavailable: true });
    getMeeting.mockResolvedValueOnce({ status: 'QUEUED' }).mockResolvedValueOnce({ status: 'RUNNING' });
    await startMeeting();
    expect(screen.getByText('00:00 / 60:00')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(12_000));
    expect(screen.getByText('00:12 / 60:00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '止める' }));
    await act(async () => {});
    expect(screen.getByRole('status')).toHaveTextContent('書き起こし中…');
    const button = screen.getByRole('button', { name: '話し合い' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('AI 未起動');
    await act(() => vi.advanceTimersByTimeAsync(4999));
    expect(getMeeting).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(getMeeting).toHaveBeenCalledExactlyOnceWith('meeting-job', expect.any(AbortSignal));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(getMeeting).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('textbox')).toHaveValue('既存。\n\n話者1: 発言。\n話者2: 了解。');
    expect(rewrite).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '戻す' }));
    expect(screen.getByRole('textbox')).toHaveValue('既存。');
  });

  it('sends automatically at 60 minutes even when the audio exceeds the short-input limit', async () => {
    FakeRecorder.audioSize = 2_000_001;
    await startMeeting();
    await act(() => vi.advanceTimersByTimeAsync(3_599_000));
    expect(screen.getByText('59:59 / 60:00')).toBeInTheDocument();
    expect(submitMeeting).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(submitMeeting).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ size: 2_000_001 }), expect.any(AbortSignal));
    expect(FakeRecorder.last.options).toMatchObject({ audioBitsPerSecond: 64_000, mimeType: 'audio/webm;codecs=opus' });
    expect(screen.getByRole('status')).toHaveTextContent('書き起こし中…');
  });

  it('shows a short error when the worker fails', async () => {
    getMeeting.mockResolvedValue({ status: 'FAILED', errorCode: 'meeting_transcribe_timeout' });
    await startMeeting();
    fireEvent.click(screen.getByRole('button', { name: '止める' }));
    await act(async () => {});
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(screen.getByRole('alert')).toHaveTextContent('時間がかかりすぎました');
    expect(screen.getByRole('button', { name: '話し合い' })).toBeEnabled();
    expect(screen.getByRole('textbox')).toHaveValue('既存。');
  });

  it('sends overflowing text to the editor on the same page and restores the edit', async () => {
    const undo = vi.fn().mockReturnValue(true);
    const onMeetingUpdate = vi.fn().mockReturnValue(undo);
    const base = '元'.repeat(9990);
    getMeeting.mockResolvedValue({ status: 'SUCCEEDED', text: '話者1: はい。\n話者2: 続き。' });
    await startMeeting(base, onMeetingUpdate);
    fireEvent.click(screen.getByRole('button', { name: '止める' }));
    await act(async () => {});
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(onMeetingUpdate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ pageIndex: 0, text: `${base}\n\n話者1: はい。` }), ['話者2: 続き。']);
    fireEvent.click(screen.getByRole('button', { name: '戻す' }));
    expect(undo).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox')).toHaveValue(base);
  });

  it('keeps recording and waiting across selection, manual edits and a save', async () => {
    await startMeeting();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '入力した文章' } });
    fireEvent.click(screen.getByRole('button', { name: '選択を外す' }));
    expect(FakeRecorder.last.state).toBe('recording');
    fireEvent.click(screen.getByRole('button', { name: '選択を変える' }));
    expect(screen.getByRole('button', { name: '話し合い' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '止める' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ビジー切替' }));
    fireEvent.click(screen.getByRole('button', { name: '最初の文章を選ぶ' }));
    expect(screen.getByRole('button', { name: '止める' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '止める' }));
    await act(async () => {});
    expect(screen.getByRole('status')).toHaveTextContent('書き起こし中…');
    fireEvent.click(screen.getByRole('button', { name: '選択を変える' }));
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(submitMeeting.mock.calls[0]?.[1].aborted).toBe(false);
    expect(getMeeting).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox')).toHaveValue('別の文章');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '最初の文章を選ぶ' }));
    expect(screen.getByRole('textbox')).toHaveValue('入力した文章');
    fireEvent.click(screen.getByRole('button', { name: '選択を変える' }));
    fireEvent.click(screen.getByRole('button', { name: 'ビジー切替' }));
    expect(screen.getByRole('button', { name: '話し合い' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '最初の文章を選ぶ' }));
    expect(screen.getByRole('textbox')).toHaveValue('入力した文章\n\n話者1: 発言。\n話者2: 了解。');
    fireEvent.click(screen.getByRole('button', { name: '戻す' }));
    expect(screen.getByRole('textbox')).toHaveValue('入力した文章');
  });

  it('does not apply a pending result to a different document', async () => {
    vi.useFakeTimers();
    meetingAvailability.mockResolvedValue(true);
    const view = render(<Harness text="既存。" documentId={documentId} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: '話し合い' }));
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: '止める' }));
    view.rerender(<Harness text="既存。" documentId={documentId} saving />);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(getMeeting).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('書き起こし中…');
    view.rerender(<Harness text="既存。" documentId="another-document" />);
    expect(screen.getByRole('textbox')).toHaveValue('既存。');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  const httpError = (status: number) => ({ isAxiosError: true, response: { status } });

  it('keeps polling through network errors, timeouts, 5xx and 429', async () => {
    getMeeting.mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce({ isAxiosError: true, code: 'ECONNABORTED' })
      .mockRejectedValueOnce(httpError(503))
      .mockRejectedValueOnce(httpError(429));
    await startMeeting();
    fireEvent.click(screen.getByRole('button', { name: '止める' }));
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(screen.getByRole('status')).toHaveTextContent('書き起こし中…');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(getMeeting).toHaveBeenCalledTimes(5);
    expect(screen.getByRole('textbox')).toHaveValue('既存。\n\n話者1: 発言。\n話者2: 了解。');
  });

  it('gives up on continuous poll failures after ten minutes and resets the window on recovery', async () => {
    getMeeting.mockRejectedValue(new Error('offline'));
    await startMeeting();
    fireEvent.click(screen.getByRole('button', { name: '止める' }));
    await act(() => vi.advanceTimersByTimeAsync(595_000));
    getMeeting.mockResolvedValueOnce({ status: 'RUNNING' });
    await act(() => vi.advanceTimersByTimeAsync(605_000));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(screen.getByRole('alert')).toHaveTextContent('書き起こしができませんでした');
  });

  it('ends polling immediately for a missing job', async () => {
    getMeeting.mockRejectedValueOnce(httpError(404));
    await startMeeting();
    fireEvent.click(screen.getByRole('button', { name: '止める' }));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(getMeeting).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert')).toHaveTextContent('書き起こしができませんでした');
  });

  it.each([true, false])('reuses the audio for at most three submissions (recovers %s)', async recovers => {
    submitMeeting.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(httpError(503));
    if (!recovers) submitMeeting.mockRejectedValue(new Error('offline'));
    await startMeeting();
    fireEvent.click(screen.getByRole('button', { name: '止める' }));
    await act(() => vi.advanceTimersByTimeAsync(9999));
    expect(submitMeeting).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(submitMeeting).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(19_999));
    expect(submitMeeting).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(submitMeeting).toHaveBeenCalledTimes(3);
    const [audio, signal] = submitMeeting.mock.calls[0]!;
    for (const [retriedAudio, retriedSignal] of submitMeeting.mock.calls.slice(1)) {
      expect(retriedAudio).toBe(audio);
      expect(retriedSignal).toBe(signal);
    }
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(submitMeeting).toHaveBeenCalledTimes(3);
    if (recovers) expect(getMeeting).toHaveBeenCalledOnce();
    else {
      expect(getMeeting).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent('書き起こしができませんでした');
    }
  });
});
