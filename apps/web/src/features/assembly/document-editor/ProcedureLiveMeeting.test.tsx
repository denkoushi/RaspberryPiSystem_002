import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAssemblyProcedureMeetingLiveAvailability } from '../../../api/domains/assembly';
import { useLocalLlmAvailability } from '../../../api/hooks/local-llm';

import { AssemblyProcedureDocumentEditorInspector } from './AssemblyProcedureDocumentEditorInspector';
import { useProcedureLiveMeeting } from './useProcedureLiveMeeting';

import type { OverlayTextElement } from '@raspi-system/shared-types';

vi.mock('../../../api/domains/assembly', () => ({
  getAssemblyProcedureMeetingLiveAvailability: vi.fn(), rewriteAssemblyProcedureDictation: vi.fn(),
  getAssemblyProcedureSpeechToTextAvailability: vi.fn(), transcribeAssemblyProcedureDictation: vi.fn()
}));
vi.mock('../../../api/client', () => ({ getResolvedClientKey: () => 'kiosk key' }));
vi.mock('../../../api/hooks/local-llm', () => ({ useLocalLlmAvailability: vi.fn() }));

class FakeSocket {
  static last: FakeSocket;
  static OPEN = 1; static CONNECTING = 0;
  readyState = 0; binaryType = ''; sent: unknown[] = []; closed = false;
  onopen: (() => void) | null = null; onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null; onclose: (() => void) | null = null;
  constructor(public url: string) { FakeSocket.last = this; }
  send(data: unknown) { this.sent.push(data); }
  close() { this.closed = true; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  emit(payload: unknown) { this.onmessage?.({ data: typeof payload === 'string' ? payload : JSON.stringify(payload) }); }
  serverClose() { this.readyState = 3; this.onclose?.(); }
}
class FakeAudioContext {
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
  destination = {};
  close = vi.fn().mockResolvedValue(undefined);
  createMediaStreamSource() { return { connect: vi.fn() }; }
}
class FakeWorkletNode {
  static last: FakeWorkletNode;
  port: { onmessage: ((e: { data: ArrayBuffer }) => void) | null } = { onmessage: null };
  constructor() { FakeWorkletNode.last = this; }
  connect = vi.fn(); disconnect = vi.fn();
}
const stopTrack = vi.fn();
const getUserMedia = vi.fn();
const makeElement = (text: string, id = 'one'): OverlayTextElement => ({ id, kind: 'TEXT', text, pageIndex: 0, zIndex: 0, bbox: { xRatio: 0, yRatio: 0, widthRatio: 0.4, heightRatio: 0.1 } });
const common = { onDelete: vi.fn(), onBringForward: vi.fn(), onSendBackward: vi.fn(), onBringToFront: vi.fn(), onSendToBack: vi.fn(), onRefetchTextCandidates: vi.fn() };
const onBegin = vi.fn();
const onEnd = vi.fn();
let latestText = '';

function Harness({ text = '' }: { text?: string }) {
  const [elements, setElements] = useState({ one: makeElement(text), two: makeElement('別', 'two') });
  const [selected, setSelected] = useState<'one' | 'two'>('one');
  const [disabled, setDisabled] = useState(false);
  const element = elements[selected];
  latestText = elements.one.text;
  const update = (next: OverlayTextElement) => setElements(current => ({ ...current, [next.id]: next }));
  const live = useProcedureLiveMeeting({ element, enabled: true, disabled, onUpdate: update, onBegin, onEnd, getTerms: () => `${elements.two.text}  語` });
  return <>
    <button onClick={() => setSelected('two')}>選択を変える</button>
    <button onClick={() => setDisabled(true)}>編集不可</button>
    <AssemblyProcedureDocumentEditorInspector {...common} key={element.id} element={element} voiceInputEnabled live={live}
      onUpdate={next => { if (next.kind === 'TEXT') update(next); }} />
  </>;
}

async function startLive() {
  fireEvent.click(await screen.findByRole('button', { name: '話し合い' }));
  await waitFor(() => expect(FakeSocket.last).toBeDefined());
  await act(async () => { FakeSocket.last.open(); });
}
const send = (payload: unknown) => act(async () => { FakeSocket.last.emit(payload); });
const final = (id: number, text: string) => send({ type: 'final', id, text });
const partial = (id: number, text: string) => send({ type: 'partial', id, text });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useLocalLlmAvailability).mockReturnValue({ unavailable: false });
  vi.mocked(getAssemblyProcedureMeetingLiveAvailability).mockResolvedValue(true);
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] });
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  URL.createObjectURL = vi.fn(() => 'blob:worklet'); URL.revokeObjectURL = vi.fn();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('live meeting input', () => {
  it('connects with the client key and streams pcm frames', async () => {
    render(<Harness />);
    await startLive();
    expect(FakeSocket.last.url).toContain('/api/assembly/procedure-documents/meeting-live?clientKey=kiosk%20key&v=2');
    const frame = new ArrayBuffer(4);
    FakeWorkletNode.last.port.onmessage?.({ data: frame });
    expect(FakeSocket.last.sent.at(-1)).toBe(frame);
    expect(onBegin).toHaveBeenCalled();
  });

  it('connects with v=2 and sends the context terms before audio', async () => {
    render(<Harness />);
    await startLive();
    expect(FakeSocket.last.url).toContain('&v=2');
    expect(FakeSocket.last.sent[0]).toBe(JSON.stringify({ type: 'context', terms: '別 語' }));
  });

  it('shows the partial as the last line and replaces it with the final', async () => {
    render(<Harness />);
    await startLive();
    await final(1, 'こんにちは');
    await partial(2, 'つぎの');
    expect(latestText).toBe('【発言記録】\nこんにちは\nつぎの');
    await partial(2, 'つぎの話');
    expect(latestText).toBe('【発言記録】\nこんにちは\nつぎの話');
    await final(2, 'つぎの話です');
    expect(latestText).toBe('【発言記録】\nこんにちは\nつぎの話です');
  });

  it('puts the organised document first and keeps both after done', async () => {
    render(<Harness text="前の文" />);
    await startLive();
    await final(1, '発言');
    await send({ type: 'doc', text: '【論点】\n・寸法', next: '納期' });
    expect(latestText).toBe('前の文\n\n【論点】\n・寸法\n\n【発言記録】\n発言');
    fireEvent.click(screen.getByRole('button', { name: '止める' }));
    expect(FakeSocket.last.sent).toContain('end');
    await send({ type: 'done' });
    expect(FakeSocket.last.closed).toBe(true);
    expect(latestText).toBe('前の文\n\n【論点】\n・寸法\n\n【発言記録】\n発言');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: '戻す' }));
    expect(latestText).toBe('前の文');
  });

  it('shows the suggested next topic while recording and hides it after stopping', async () => {
    render(<Harness />);
    await startLive();
    expect(screen.queryByTestId('procedure-live-next')).toBeNull();
    await send({ type: 'doc', text: '【論点】\n・寸法', next: '納期を決めましょう。' });
    expect(screen.getByTestId('procedure-live-next').textContent).toBe('納期を決めましょう。');
    await send({ type: 'doc', text: '【論点】\n・寸法', next: '担当を決めましょう。' });
    expect(screen.getByTestId('procedure-live-next').textContent).toBe('担当を決めましょう。');
    await send({ type: 'doc', text: '【論点】\n・寸法', next: '' });
    expect(screen.queryByTestId('procedure-live-next')).toBeNull();
    await send({ type: 'doc', text: '【論点】\n・寸法', next: '納期を決めましょう。' });
    fireEvent.click(screen.getByRole('button', { name: '止める' }));
    expect(screen.queryByTestId('procedure-live-next')).toBeNull();
    await send({ type: 'doc', text: '【論点】\n・寸法', next: '遅れて届いた案' });
    expect(screen.queryByTestId('procedure-live-next')).toBeNull();
  });

  it('drops the oldest raw lines first when the text gets too long', async () => {
    render(<Harness />);
    await startLive();
    const long = 'あ'.repeat(4_000);
    await final(1, long);
    await final(2, long.replace(/あ/gu, 'い'));
    await final(3, long.replace(/あ/gu, 'う'));
    expect(latestText.length).toBeLessThanOrEqual(10_000);
    expect(latestText).toContain('う');
    expect(latestText).not.toContain('あ');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the busy message and stops', async () => {
    render(<Harness />);
    await startLive();
    await act(async () => { FakeSocket.last.emit({ type: 'error', error: 'busy' }); });
    expect(screen.getByRole('alert').textContent).toBe('混んでいます');
    expect(FakeSocket.last.closed).toBe(true);
    expect(onEnd).toHaveBeenCalled();
  });

  it('sends end on stop, releases the mic, and keeps appending until done', async () => {
    render(<Harness />);
    await startLive();
    fireEvent.click(screen.getByRole('button', { name: '止める' }));
    expect(FakeSocket.last.sent).toContain('end');
    expect(stopTrack).toHaveBeenCalled();
    expect(FakeSocket.last.closed).toBe(false);
    await final(1, '最後');
    expect(latestText).toBe('【発言記録】\n最後');
    await act(async () => { FakeSocket.last.serverClose(); });
    expect(FakeSocket.last.closed).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: '戻す' }));
    expect(latestText).toBe('');
  });

  it('stops when the selected element changes', async () => {
    render(<Harness />);
    await startLive();
    fireEvent.click(screen.getByText('選択を変える'));
    await waitFor(() => expect(FakeSocket.last.closed).toBe(true));
    await final(1, '無視');
    expect(latestText).toBe('');
  });

  it('stops when editing becomes disabled', async () => {
    render(<Harness />);
    await startLive();
    fireEvent.click(screen.getByText('編集不可'));
    await waitFor(() => expect(FakeSocket.last.closed).toBe(true));
  });

  it('refuses when the organised document alone exceeds the maximum length', async () => {
    render(<Harness text={'あ'.repeat(9_995)} />);
    await startLive();
    await send({ type: 'doc', text: 'いいいいいいいいいい', next: '' });
    expect(latestText).toBe('あ'.repeat(9_995));
    expect(screen.getByRole('alert').textContent).toBe('長すぎます');
    expect(FakeSocket.last.closed).toBe(true);
  });

  it('reports a generic failure when the microphone is unavailable', async () => {
    getUserMedia.mockRejectedValue(new Error('denied'));
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: '話し合い' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('書き起こしができませんでした');
  });
});
