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
  const live = useProcedureLiveMeeting({ element, enabled: true, disabled, onUpdate: update, onBegin, onEnd });
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
const speak = (spk: number, text: string, t: number) => act(async () => { FakeSocket.last.emit({ spk, text, t }); });

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
    expect(FakeSocket.last.url).toContain('/api/assembly/procedure-documents/meeting-live?clientKey=kiosk%20key');
    const frame = new ArrayBuffer(4);
    FakeWorkletNode.last.port.onmessage?.({ data: frame });
    expect(FakeSocket.last.sent).toEqual([frame]);
    expect(onBegin).toHaveBeenCalled();
  });

  it('merges the same speaker and starts a new line for another speaker or a gap', async () => {
    render(<Harness />);
    await startLive();
    await speak(0, 'こんにちは。', 1);
    expect(latestText).toBe('話者0: こんにちは。');
    await speak(0, 'よろしく。', 3);
    expect(latestText).toBe('話者0: こんにちは。よろしく。');
    await speak(1, 'はい。', 4);
    expect(latestText).toBe('話者0: こんにちは。よろしく。\n話者1: はい。');
    await speak(1, 'また。', 20);
    expect(latestText).toBe('話者0: こんにちは。よろしく。\n話者1: はい。\n話者1: また。');
  });

  it('appends to existing text and keeps manual edits', async () => {
    render(<Harness text="前の文" />);
    await startLive();
    await speak(0, '追加', 1);
    expect(latestText).toBe('前の文\n話者0: 追加');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '前の文\n話者0: 追加!' } });
    await speak(0, 'つづき', 2);
    expect(latestText).toBe('前の文\n話者0: 追加!つづき');
  });

  it('shows the busy message and stops', async () => {
    render(<Harness />);
    await startLive();
    await act(async () => { FakeSocket.last.emit({ error: 'busy' }); });
    expect(screen.getByRole('alert').textContent).toBe('混んでいます');
    expect(FakeSocket.last.closed).toBe(true);
    expect(onEnd).toHaveBeenCalled();
  });

  it('sends end on stop, releases the mic, and keeps appending until the server closes', async () => {
    render(<Harness />);
    await startLive();
    fireEvent.click(screen.getByRole('button', { name: '止める' }));
    expect(FakeSocket.last.sent).toContain('end');
    expect(stopTrack).toHaveBeenCalled();
    expect(FakeSocket.last.closed).toBe(false);
    await speak(0, '最後', 1);
    expect(latestText).toBe('話者0: 最後');
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
    await speak(0, '無視', 1);
    expect(latestText).toBe('');
  });

  it('stops when editing becomes disabled', async () => {
    render(<Harness />);
    await startLive();
    fireEvent.click(screen.getByText('編集不可'));
    await waitFor(() => expect(FakeSocket.last.closed).toBe(true));
  });

  it('refuses to exceed the maximum length', async () => {
    render(<Harness text={'あ'.repeat(9_995)} />);
    await startLive();
    await speak(0, 'いいいいいいいいいい', 1);
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
