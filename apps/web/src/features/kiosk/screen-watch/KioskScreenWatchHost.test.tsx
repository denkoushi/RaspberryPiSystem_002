import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publishSignaling, registerSignalingSender } from '../../webrtc/signalingBus';

import { ScreenWatchHost } from './KioskScreenWatchHost';
import { MockPeerConnection, mockStream } from './peerTestHelpers';
import { startWatch } from './startWatch';

import type { WatchMessageType } from '../../webrtc/types';

const mocks = vi.hoisted(() => ({ post: vi.fn(), useAuth: vi.fn() }));
vi.mock('../../../api/client', () => ({ api: { post: mocks.post }, getResolvedClientKey: () => 'device' }));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: mocks.useAuth }));
const loggedIn = { user: { role: 'MANAGER' }, token: 'token' };
const loggedOut = { user: null, token: null };
const send = vi.fn(() => true);
let release: () => void;
const receive = (type: WatchMessageType, reason?: string) => {
  act(() => publishSignaling({ type, payload: { watchId: 'watch-1', viewerName: 'StoneBase01', reason } }));
};
beforeEach(() => {
  vi.stubGlobal('RTCPeerConnection', MockPeerConnection);
  MockPeerConnection.instances = [];
  send.mockReset().mockReturnValue(true);
  release = registerSignalingSender(send);
  mocks.post.mockReset().mockResolvedValue({ data: { watchId: 'watch-1' } });
  mocks.useAuth.mockReset().mockReturnValue(loggedOut);
});
afterEach(() => { release(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('screen watch UI', () => {
  it('shows consent and starts capture synchronously before accepting', async () => {
    const capture = vi.fn(async () => mockStream().stream);
    render(<ScreenWatchHost clientKey="device" startCapture={capture} />);
    receive('watch.request');
    expect(screen.getByRole('dialog', { name: 'StoneBase01 が この画面を見ます' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '見せる' }));
    expect(capture).toHaveBeenCalledOnce();
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'watch.accept', payload: { watchId: 'watch-1' } }));
    expect(screen.getByText('StoneBase01 が見ています')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '止める' }));
    expect(send).toHaveBeenLastCalledWith({ type: 'watch.stop', payload: { watchId: 'watch-1' } });
  });
  it('denies and closes consent', () => {
    render(<ScreenWatchHost clientKey="device" />); receive('watch.request');
    fireEvent.click(screen.getByRole('button', { name: '断る' }));
    expect(send).toHaveBeenLastCalledWith({ type: 'watch.deny', payload: { watchId: 'watch-1' } });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('reports capture failure without accepting', async () => {
    render(<ScreenWatchHost clientKey="device" startCapture={() => Promise.reject(new DOMException('denied', 'NotAllowedError'))} />);
    receive('watch.request'); fireEvent.click(screen.getByRole('button', { name: '見せる' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'watch.fail', payload: { watchId: 'watch-1', reason: 'NotAllowedError' } }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('closes consent on stop and ignores a late capture resolution', async () => {
    let finish!: (stream: MediaStream) => void;
    render(<ScreenWatchHost clientKey="device" startCapture={() => new Promise(resolve => { finish = resolve; })} />);
    receive('watch.request'); fireEvent.click(screen.getByRole('button', { name: '見せる' }));
    const { stream, track } = mockStream();
    receive('watch.stopped', 'timeout'); await act(async () => finish(stream));
    expect(track.stop).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('requests via HTTP, renders waiting then the video, and stops', async () => {
    render(<ScreenWatchHost clientKey="device" />);
    await act(() => startWatch('thread', 'badge', '加工キオスク'));
    expect(mocks.post).toHaveBeenCalledWith('/kiosk/inquiries/thread/watch', { employeeTagUid: 'badge' }, { headers: { 'x-client-key': 'device' } });
    expect(screen.getByText('相手の「見せる」を待っています')).toBeInTheDocument();
    receive('watch.accepted');
    expect(screen.getByLabelText('画面の映像')).toBeInTheDocument();
    expect(screen.getByText('● 加工キオスク')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '指さし' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: '■ 止める' }));
    expect(send).toHaveBeenLastCalledWith({ type: 'watch.stop', payload: { watchId: 'watch-1' } });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
  it.each([
    { role: 'target', pointerType: 'touch', stopName: '止める', startLeft: 700, startTop: 16, maxLeft: 824, maxTop: 728 },
    { role: 'viewer', pointerType: 'mouse', stopName: '■ 止める', startLeft: 36, startTop: 400, maxLeft: 400, maxTop: 440 }
  ])('drags the $role pill inside its bounds and keeps its stop button clickable', async ({
    role, pointerType, stopName, startLeft, startTop, maxLeft, maxTop
  }) => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('innerWidth', 1024);
    vi.stubGlobal('innerHeight', 768);
    render(<ScreenWatchHost clientKey="device" startCapture={async () => mockStream().stream} />);
    if (role === 'target') {
      receive('watch.request');
      await act(async () => fireEvent.click(screen.getByRole('button', { name: '見せる' })));
    } else {
      await act(() => startWatch('thread', 'badge', '加工キオスク'));
      receive('watch.accepted');
      const section = screen.getByRole('region', { name: '画面を見る' });
      Object.defineProperties(section, { clientWidth: { value: 600 }, clientHeight: { value: 480 } });
      section.getBoundingClientRect = () => new DOMRect(20, 30, 600, 480);
    }
    const stop = screen.getByRole('button', { name: stopName });
    const pill = stop.parentElement!;
    pill.getBoundingClientRect = () => new DOMRect(startLeft, startTop, 200, 40);
    pill.setPointerCapture = vi.fn();
    const pointer = (type: string, element: Element, clientX: number, clientY: number) =>
      fireEvent(element, Object.assign(new MouseEvent(type, { bubbles: true, clientX, clientY }), { pointerId: 1, pointerType }));

    pointer('pointerdown', stop, 50, 50);
    pointer('pointermove', pill, 100, 100);
    pointer('pointerup', stop, 100, 100);
    expect(pill.setPointerCapture).not.toHaveBeenCalled();
    expect(pill.style.left).toBe('');
    expect(pill.style.top).toBe('');

    pointer('pointerdown', pill.querySelector('span')!, 50, 50);
    expect(pill.setPointerCapture).toHaveBeenCalledWith(1);
    pointer('pointermove', pill, 52, 51);
    expect(pill.style.left).toBe('');
    expect(pill.style.top).toBe('');
    pointer('pointermove', pill, 60, 70);
    expect(pill).toHaveStyle({
      left: `${startLeft + (role === 'viewer' ? -10 : 10)}px`,
      top: `${startTop + (role === 'viewer' ? -10 : 20)}px`
    });
    pointer('pointermove', pill, 2000, 2000);
    expect(pill).toHaveStyle({ left: `${maxLeft}px`, top: `${maxTop}px` });
    pointer('pointermove', pill, -2000, -2000);
    expect(pill).toHaveStyle({ left: '0px', top: '0px' });
    pointer('pointerup', pill, -2000, -2000);
    pointer('pointermove', pill, 2000, 2000);
    expect(pill).toHaveStyle({ left: '0px', top: '0px' });
    fireEvent.click(stop);
    expect(send).toHaveBeenLastCalledWith({ type: 'watch.stop', payload: { watchId: 'watch-1' } });
  });
  it('uses the same HTTP client without a badge for a login watch', async () => {
    mocks.useAuth.mockReturnValue(loggedIn);
    render(<ScreenWatchHost clientKey="device" />);
    await act(() => startWatch('thread', undefined, '加工キオスク'));
    expect(mocks.post).toHaveBeenCalledWith('/kiosk/inquiries/thread/watch', {}, { headers: { 'x-client-key': 'device' } });
  });
  it.each(['viewing', 'operating'])('stops a login watch on logout while %s', async mode => {
    mocks.useAuth.mockReturnValue(loggedIn);
    const { rerender } = render(<ScreenWatchHost clientKey="device" />);
    await act(() => startWatch('thread', undefined, '加工キオスク'));
    receive('watch.accepted');
    if (mode === 'operating') {
      fireEvent.click(screen.getByRole('button', { name: '操作' }));
      receive('watch.control.accepted');
    }
    mocks.useAuth.mockReturnValue(loggedOut);
    rerender(<ScreenWatchHost clientKey="device" />);
    expect(send).toHaveBeenLastCalledWith({ type: 'watch.stop', payload: { watchId: 'watch-1' } });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(MockPeerConnection.instances[0].close).toHaveBeenCalledOnce();
    expect(fireEvent.keyDown(document.body, { key: 'A' })).toBe(true);
  });
  it('stops a login watch that receives its ID after login is lost', async () => {
    mocks.useAuth.mockReturnValue(loggedIn);
    let resolve!: (data: unknown) => void;
    mocks.post.mockReturnValue(new Promise(done => { resolve = done; }));
    const { rerender } = render(<ScreenWatchHost clientKey="device" />);
    let request!: Promise<void>;
    act(() => { request = startWatch('thread', undefined, '加工キオスク'); });
    expect(screen.getByRole('region')).toBeInTheDocument();
    mocks.useAuth.mockReturnValue({ ...loggedIn, token: null });
    rerender(<ScreenWatchHost clientKey="device" />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    await act(async () => { resolve({ data: { watchId: 'watch-1' } }); await request; });
    expect(send).toHaveBeenLastCalledWith({ type: 'watch.stop', payload: { watchId: 'watch-1' } });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
  it('keeps a badge watch open when login is lost', async () => {
    mocks.useAuth.mockReturnValue(loggedIn);
    const { rerender } = render(<ScreenWatchHost clientKey="device" />);
    await act(() => startWatch('thread', 'badge', '加工キオスク'));
    receive('watch.accepted');
    mocks.useAuth.mockReturnValue(loggedOut);
    rerender(<ScreenWatchHost clientKey="device" />);
    expect(screen.getByLabelText('画面の映像')).toBeInTheDocument();
    expect(send).not.toHaveBeenCalledWith({ type: 'watch.stop', payload: { watchId: 'watch-1' } });
  });
  it.each([
    ['watch.denied', undefined, '断られました'],
    ['watch.stopped', 'target', '相手が止めました'],
    ['watch.stopped', 'timeout', '応答がありませんでした'],
    ['watch.stopped', 'NotAllowedError', '相手の端末で 画面を取れませんでした']
  ] as const)('shows the short message for %s %s', async (type, reason, text) => {
    render(<ScreenWatchHost clientKey="device" />); await act(() => startWatch('thread', 'badge', '加工キオスク'));
    receive(type, reason); expect(screen.getByRole('status')).toHaveTextContent(text);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
  it.each([
    ['KIOSK_SCREEN_WATCH_TARGET_OFFLINE', '相手の端末が つながっていません'],
    ['KIOSK_SCREEN_WATCH_BUSY', 'ほかの人が見ています']
  ])('shows HTTP error %s', async (errorCode, text) => {
    mocks.post.mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { errorCode } } });
    render(<ScreenWatchHost clientKey="device" />); await act(() => startWatch('thread', 'badge', '加工キオスク'));
    expect(screen.getByRole('status')).toHaveTextContent(text); expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
  it('handles acceptance arriving before the HTTP response', async () => {
    mocks.post.mockImplementation(async () => {
      publishSignaling({ type: 'watch.accepted', payload: { watchId: 'watch-1' } });
      return { data: { watchId: 'watch-1' } };
    });
    render(<ScreenWatchHost clientKey="device" />); await act(() => startWatch('thread', 'badge', '加工キオスク'));
    expect(screen.getByLabelText('画面の映像')).toBeInTheDocument();
  });
  it('stops a request cancelled before HTTP returns', async () => {
    let resolve!: (data: unknown) => void;
    mocks.post.mockReturnValue(new Promise(done => { resolve = done; }));
    render(<ScreenWatchHost clientKey="device" />);
    let request!: Promise<void>;
    act(() => { request = startWatch('thread', 'badge', '加工キオスク'); });
    fireEvent.click(screen.getByRole('button', { name: '■ 止める' }));
    await act(async () => { resolve({ data: { watchId: 'watch-1' } }); await request; });
    expect(send).toHaveBeenLastCalledWith({ type: 'watch.stop', payload: { watchId: 'watch-1' } });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
  it('closes local UI on socket disconnect', async () => {
    render(<ScreenWatchHost clientKey="device" />); await act(() => startWatch('thread', 'badge', '加工キオスク'));
    act(() => release());
    expect(screen.queryByRole('region')).not.toBeInTheDocument(); expect(screen.getByRole('status')).toHaveTextContent('接続が切れました');
  });
});

describe('screen watch remote control', () => {
  const beginTargetWatch = async () => {
    receive('watch.request');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '見せる' })));
    receive('watch.control.request');
  };
  const input = (payload: Record<string, unknown>) =>
    act(() => publishSignaling({ type: 'watch.input', payload: { watchId: 'watch-1', ...payload } }));
  const acceptControl = async () => {
    await beginTargetWatch();
    fireEvent.click(screen.getByRole('button', { name: '任せる' }));
  };

  it('focuses refusal immediately when control consent opens', async () => {
    render(<ScreenWatchHost clientKey="device" startCapture={async () => mockStream().stream} />);
    await beginTargetWatch();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '断る' }));
  });

  it('asks for control consent, forwards clicks and stops control before viewing', async () => {
    const clicks = vi.fn();
    const blurred = vi.fn();
    const { container } = render(<>
      <button type="button" onClick={clicks}>現場のボタン</button>
      <input aria-label="保存する欄" onBlur={blurred} />
      <div>余白</div>
      <ScreenWatchHost clientKey="device" startCapture={async () => mockStream().stream} />
    </>);
    await beginTargetWatch();
    const dialog = screen.getByRole('dialog', { name: 'StoneBase01 が この画面を操作します' });
    fireEvent.mouseDown(dialog);
    expect(dialog).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '任せる' }));
    expect(send).toHaveBeenLastCalledWith({ type: 'watch.control.accept', payload: { watchId: 'watch-1' } });
    expect(screen.getByText('StoneBase01 が操作しています')).toBeInTheDocument();
    expect(dialog).not.toBeInTheDocument();

    const button = screen.getByRole('button', { name: '現場のボタン' });
    const events: string[] = [];
    for (const type of ['pointermove', 'mousemove', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      button.addEventListener(type, event => events.push(event.type));
    }
    vi.stubGlobal('PointerEvent', MouseEvent);
    const stop = screen.getByRole('button', { name: '止める' });
    const pointerRing = document.createElement('div');
    pointerRing.className = 'screen-watch__pointer';
    const elementsFromPoint = vi.fn().mockReturnValue([stop, stop.parentElement, button]);
    const previousHitTest = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: elementsFromPoint });
    try {
      input({ kind: 'move', x: .25, y: .75 });
      expect(container.querySelector('.screen-watch__cursor')).toHaveTextContent('StoneBase01');
      expect(container.querySelector('.screen-watch__cursor')).toHaveStyle({ left: '25vw', top: '75vh' });
      expect(elementsFromPoint).toHaveBeenCalledWith(window.innerWidth * .25, window.innerHeight * .75);
      expect(events).toEqual(['pointermove', 'mousemove']);
      const cursor = container.querySelector('.screen-watch__cursor span');
      elementsFromPoint.mockReturnValue([pointerRing, cursor, stop, stop.parentElement, button]);
      input({ kind: 'click', x: .5, y: .25 });
      expect(elementsFromPoint).toHaveBeenCalledWith(window.innerWidth * .5, window.innerHeight * .25);
      expect(events).toEqual(['pointermove', 'mousemove', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
      expect(clicks).toHaveBeenCalledOnce();
      expect(button).toHaveFocus();
      expect(container.querySelector('.screen-watch__ripple')).toHaveStyle({ left: '50vw', top: '25vh' });

      const field = screen.getByRole('textbox', { name: '保存する欄' });
      field.focus();
      elementsFromPoint.mockReturnValue([container.querySelector('.screen-watch__ripple'), screen.getByText('余白')]);
      input({ kind: 'click', x: .5, y: .25 });
      expect(field).not.toHaveFocus();
      expect(blurred).toHaveBeenCalledOnce();

      elementsFromPoint.mockReturnValue([stop]);
      input({ kind: 'click', x: .9, y: .1 });
      expect(screen.getByText('StoneBase01 が操作しています')).toBeInTheDocument();
      fireEvent.click(stop);
      expect(send).toHaveBeenLastCalledWith({ type: 'watch.control.stop', payload: { watchId: 'watch-1' } });
      expect(screen.getByText('StoneBase01 が見ています')).toBeInTheDocument();
      expect(container.querySelector('.screen-watch__cursor')).not.toBeInTheDocument();
      expect(container.querySelector('.screen-watch__ripple')).not.toBeInTheDocument();
      expect(MockPeerConnection.instances[0].close).not.toHaveBeenCalled();
      elementsFromPoint.mockReturnValue([button]);
      input({ kind: 'click', x: .5, y: .25 });
      expect(clicks).toHaveBeenCalledOnce();
      fireEvent.click(stop);
      expect(send).toHaveBeenLastCalledWith({ type: 'watch.stop', payload: { watchId: 'watch-1' } });
    } finally {
      if (previousHitTest) Object.defineProperty(document, 'elementsFromPoint', previousHitTest);
      else Reflect.deleteProperty(document, 'elementsFromPoint');
    }
  });

  it.each(['consent-overlay', 'notice'])('blocks remote pointer input over the %s', async overlay => {
    const clicks = vi.fn();
    const moves = vi.fn();
    render(<>
      <div className={`screen-watch__${overlay}`}><span>覆い</span></div>
      <button type="button" onClick={clicks} onMouseMove={moves}>現場のボタン</button>
      <ScreenWatchHost clientKey="device" startCapture={async () => mockStream().stream} />
    </>);
    await acceptControl();
    const cover = screen.getByText('覆い');
    const button = screen.getByRole('button', { name: '現場のボタン' });
    const previousHitTest = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true, value: () => [cover, cover.parentElement, button]
    });
    try {
      input({ kind: 'click', x: .5, y: .25 });
      input({ kind: 'move', x: .5, y: .25 });
      expect(clicks).not.toHaveBeenCalled();
      expect(moves).not.toHaveBeenCalled();
      expect(button).not.toHaveFocus();
    } finally {
      if (previousHitTest) Object.defineProperty(document, 'elementsFromPoint', previousHitTest);
      else Reflect.deleteProperty(document, 'elementsFromPoint');
    }
  });

  it('types into a React controlled input, handles Enter and leaves password fields alone', async () => {
    const changed = vi.fn();
    const keydown = vi.fn();
    const submitted = vi.fn();
    function Field() {
      const [value, setValue] = useState('ab');
      return <form onSubmit={event => { event.preventDefault(); submitted(); }}>
        <input aria-label="入力欄" value={value} onKeyDown={event => keydown(event.key)}
          onChange={event => { setValue(event.target.value); changed(event.target.value); }} />
        <input aria-label="パスワード" type="password" />
        <button>送信</button>
      </form>;
    }
    render(<><Field /><ScreenWatchHost clientKey="device" startCapture={async () => mockStream().stream} /></>);
    await beginTargetWatch();
    fireEvent.click(screen.getByRole('button', { name: '任せる' }));
    const field = screen.getByRole('textbox', { name: '入力欄' }) as HTMLInputElement;
    field.focus();
    field.setSelectionRange(1, 1);
    input({ kind: 'key', key: 'Z' });
    expect(field).toHaveValue('aZb');
    expect(changed).toHaveBeenLastCalledWith('aZb');
    input({ kind: 'key', key: 'Backspace' });
    expect(field).toHaveValue('ab');
    expect(changed).toHaveBeenLastCalledWith('ab');
    input({ kind: 'key', key: 'ArrowLeft' });
    expect(keydown).toHaveBeenLastCalledWith('ArrowLeft');
    expect(field.selectionStart).toBe(0);
    input({ kind: 'key', key: 'ArrowRight' });
    expect(field.selectionStart).toBe(1);
    input({ kind: 'key', key: 'Escape' });
    expect(keydown).toHaveBeenLastCalledWith('Escape');
    input({ kind: 'key', key: 'Enter' });
    expect(keydown).toHaveBeenLastCalledWith('Enter');
    expect(submitted).toHaveBeenCalledOnce();
    const password = screen.getByLabelText('パスワード');
    password.focus();
    input({ kind: 'key', key: 'a' });
    input({ kind: 'key', key: 'Enter' });
    expect(password).toHaveValue('');
    expect(submitted).toHaveBeenCalledOnce();
  });

  it.each(['1.5', '-3'])('types %s into a controlled number field without emitting incomplete values', async value => {
    const changed = vi.fn();
    function Field() {
      const [text, setText] = useState('');
      return <input type="number" value={text} onChange={event => {
        setText(event.target.value); changed(event.target.value);
      }} />;
    }
    render(<><Field /><ScreenWatchHost clientKey="device" startCapture={async () => mockStream().stream} /></>);
    await acceptControl();
    const field = screen.getByRole('spinbutton');
    field.focus();
    for (const key of value) input({ kind: 'key', key });
    expect(field).toHaveValue(Number(value));
    expect(changed.mock.calls.flat()).toEqual(value === '1.5' ? ['1', '1.5'] : ['-3']);
  });

  it('discards an unfinished number after focus leaves the field', async () => {
    render(<>
      <input type="number" /><input aria-label="別の欄" />
      <ScreenWatchHost clientKey="device" startCapture={async () => mockStream().stream} />
    </>);
    await acceptControl();
    const field = screen.getByRole('spinbutton');
    field.focus();
    input({ kind: 'key', key: '-' });
    screen.getByRole('textbox', { name: '別の欄' }).focus();
    field.focus();
    input({ kind: 'key', key: '3' });
    expect(field).toHaveValue(3);
  });

  it.each([
    ['disabled first submitter', 0],
    ['one field without a submitter', 1],
    ['two fields without a submitter', 0]
  ] as const)('uses implicit form submission with %s', async (scenario, submitCount) => {
    const submitted = vi.fn();
    render(<>
      <form onSubmit={event => { event.preventDefault(); submitted(); }}>
        <input aria-label="入力欄" />
        {scenario === 'disabled first submitter' && <><button disabled>送信</button><input type="submit" /></>}
        {scenario === 'two fields without a submitter' && <input aria-label="別の欄" />}
      </form>
      <ScreenWatchHost clientKey="device" startCapture={async () => mockStream().stream} />
    </>);
    await acceptControl();
    screen.getByRole('textbox', { name: '入力欄' }).focus();
    input({ kind: 'key', key: 'Enter' });
    expect(submitted).toHaveBeenCalledTimes(submitCount);
  });

  it('inserts a newline into a textarea without submitting the form', async () => {
    const submitted = vi.fn();
    render(<>
      <form onSubmit={event => { event.preventDefault(); submitted(); }}>
        <textarea defaultValue="ab" /><button>送信</button>
      </form>
      <ScreenWatchHost clientKey="device" startCapture={async () => mockStream().stream} />
    </>);
    await acceptControl();
    const field = screen.getByRole('textbox') as HTMLTextAreaElement;
    field.focus();
    field.setSelectionRange(1, 1);
    input({ kind: 'key', key: 'Enter' });
    expect(field).toHaveValue('a\nb');
    expect(field.selectionStart).toBe(2);
    expect(submitted).not.toHaveBeenCalled();
  });

  it('tabs between page fields and buttons, skipping disabled and screen-watch controls', async () => {
    render(<>
      <input aria-label="入力欄" /><button disabled>無効</button>
      <ScreenWatchHost clientKey="device" startCapture={async () => mockStream().stream} />
      <button>次の要素</button>
    </>);
    await acceptControl();
    const field = screen.getByRole('textbox');
    field.focus();
    input({ kind: 'key', key: 'Tab' });
    expect(screen.getByRole('button', { name: '次の要素' })).toHaveFocus();
    input({ kind: 'key', key: 'Tab' });
    expect(field).toHaveFocus();
  });

  it.each(['on', 'requested'])('goes off on a control accept error when control is %s', async control => {
    render(<ScreenWatchHost clientKey="device" startCapture={async () => mockStream().stream} />);
    await acceptControl();
    if (control === 'requested') {
      receive('watch.control.stopped');
      receive('watch.control.request');
    }
    act(() => publishSignaling({ type: 'error', payload: { watchId: 'watch-1', requestType: 'watch.control.accept' } }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('StoneBase01 が見ています')).toBeInTheDocument();
    receive('watch.control.request');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('denies target consent without ending viewing', async () => {
    render(<ScreenWatchHost clientKey="device" startCapture={async () => mockStream().stream} />);
    await beginTargetWatch();
    fireEvent.click(screen.getByRole('button', { name: '断る' }));
    expect(send).toHaveBeenLastCalledWith({ type: 'watch.control.deny', payload: { watchId: 'watch-1' } });
    expect(screen.getByText('StoneBase01 が見ています')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('waits for consent and shows denial without closing the viewer', async () => {
    render(<ScreenWatchHost clientKey="device" />);
    await act(() => startWatch('thread', 'badge', '加工キオスク'));
    receive('watch.accepted');
    fireEvent.click(screen.getByRole('button', { name: '操作' }));
    expect(send).toHaveBeenLastCalledWith({ type: 'watch.control.request', payload: { watchId: 'watch-1' } });
    expect(screen.getByRole('button', { name: '操作…' })).toBeDisabled();
    receive('watch.control.denied');
    expect(screen.getAllByRole('status').some(status => status.textContent === '断られました')).toBe(true);
    expect(screen.getByLabelText('画面の映像')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '操作' })).toBeEnabled();
  });

  it('stops a control request after 30 seconds and leaves the video open', async () => {
    vi.useFakeTimers();
    render(<ScreenWatchHost clientKey="device" />);
    await act(() => startWatch('thread', 'badge', '加工キオスク'));
    receive('watch.accepted');
    fireEvent.click(screen.getByRole('button', { name: '操作' }));
    const stop = { type: 'watch.control.stop', payload: { watchId: 'watch-1' } };
    act(() => { vi.advanceTimersByTime(29_999); });
    expect(send).not.toHaveBeenCalledWith(stop);
    expect(screen.getByRole('button', { name: '操作…' })).toBeDisabled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(send).toHaveBeenLastCalledWith(stop);
    expect(screen.getByText('応答がありませんでした')).toHaveAttribute('role', 'status');
    expect(screen.getByLabelText('画面の映像')).toBeInTheDocument();
    receive('watch.control.accepted');
    expect(screen.getByRole('button', { name: '操作' })).toHaveAttribute('aria-pressed', 'false');
  });

  it.each(['watch.control.accepted', 'watch.control.denied'] as const)('cancels the control timeout on %s', async reply => {
    vi.useFakeTimers();
    render(<ScreenWatchHost clientKey="device" />);
    await act(() => startWatch('thread', 'badge', '加工キオスク'));
    receive('watch.accepted');
    fireEvent.click(screen.getByRole('button', { name: '操作' }));
    receive(reply);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(send).not.toHaveBeenCalledWith({ type: 'watch.control.stop', payload: { watchId: 'watch-1' } });
    expect(screen.queryByText('応答がありませんでした')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '操作' })).toHaveAttribute('aria-pressed', String(reply === 'watch.control.accepted'));
  });

  it('sends normalized clicks, throttled moves and allowed keys only while operating', async () => {
    render(<ScreenWatchHost clientKey="device" />);
    await act(() => startWatch('thread', 'badge', '加工キオスク'));
    receive('watch.accepted');
    const pointing = screen.getByRole('button', { name: '指さし' });
    fireEvent.click(pointing);
    fireEvent.click(screen.getByRole('button', { name: '操作' }));
    receive('watch.control.accepted');
    const operation = screen.getByRole('button', { name: '操作' });
    expect(operation).toHaveAttribute('aria-pressed', 'true');
    expect(pointing).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('region', { name: '画面を見る' })).toHaveClass('screen-watch__viewer--operating');
    const video = screen.getByLabelText('画面の映像');
    Object.defineProperties(video, { videoWidth: { value: 400 }, videoHeight: { value: 200 } });
    vi.spyOn(video, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 400 } as DOMRect);
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    try {
      send.mockClear();
      fireEvent.click(video, { clientX: 100, clientY: 50 });
      expect(send).not.toHaveBeenCalled();
      fireEvent.click(video, { clientX: 100, clientY: 150 });
      expect(send).toHaveBeenLastCalledWith({ type: 'watch.input', payload: { watchId: 'watch-1', kind: 'click', x: .25, y: .25 } });
      fireEvent.mouseMove(video, { clientX: 200, clientY: 200 });
      expect(send).toHaveBeenLastCalledWith({ type: 'watch.input', payload: { watchId: 'watch-1', kind: 'move', x: .5, y: .5 } });
      now.mockReturnValue(1049);
      fireEvent.mouseMove(video, { clientX: 300, clientY: 250 });
      expect(send).toHaveBeenCalledTimes(2);
      now.mockReturnValue(1050);
      fireEvent.mouseMove(video, { clientX: 300, clientY: 250 });
      expect(send).toHaveBeenLastCalledWith({ type: 'watch.input', payload: { watchId: 'watch-1', kind: 'move', x: .75, y: .75 } });
      expect(fireEvent.keyDown(document.body, { key: 'A' })).toBe(false);
      expect(send).toHaveBeenLastCalledWith({ type: 'watch.input', payload: { watchId: 'watch-1', kind: 'key', key: 'A' } });
      for (const init of [{ key: 'あ' }, { key: 'a', isComposing: true }, { key: 'a', ctrlKey: true },
        { key: 'a', metaKey: true }, { key: 'a', altKey: true }, { key: 'ArrowUp' }, { key: 'Tab', shiftKey: true }]) {
        expect(fireEvent.keyDown(document.body, init)).toBe(true);
      }
      expect(send).toHaveBeenCalledTimes(4);
    } finally {
      now.mockRestore();
    }
    fireEvent.click(pointing);
    expect(send).toHaveBeenLastCalledWith({ type: 'watch.control.stop', payload: { watchId: 'watch-1' } });
    act(() => publishSignaling({ type: 'error', payload: { watchId: 'watch-1', requestType: 'watch.input' } }));
    expect(video).toBeInTheDocument();
    expect(operation).toHaveAttribute('aria-pressed', 'false');
    expect(pointing).toHaveAttribute('aria-pressed', 'true');
    expect(fireEvent.keyDown(document.body, { key: 'A' })).toBe(true);
  });

  it('stops only control when the viewer presses the operation button again', async () => {
    render(<ScreenWatchHost clientKey="device" />);
    await act(() => startWatch('thread', 'badge', '加工キオスク'));
    receive('watch.accepted');
    fireEvent.click(screen.getByRole('button', { name: '操作' }));
    receive('watch.control.accepted');
    fireEvent.click(screen.getByRole('button', { name: '操作' }));
    expect(send).toHaveBeenLastCalledWith({ type: 'watch.control.stop', payload: { watchId: 'watch-1' } });
    expect(screen.getByLabelText('画面の映像')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '操作' })).toHaveAttribute('aria-pressed', 'false');
  });
});


describe('screen watch video and pointer', () => {
  const accept = async () => {
    await act(() => startWatch('thread', 'badge', '加工キオスク'));
    receive('watch.accepted');
  };
  it('calls real getDisplayMedia in the click before accept, then sends an offer', async () => {
    const { stream, track } = mockStream();
    const capture = vi.fn(async () => stream);
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: capture } });
    render(<ScreenWatchHost clientKey="device" />); receive('watch.request');
    fireEvent.click(screen.getByRole('button', { name: '見せる' }));
    expect(capture).toHaveBeenCalledWith({ video: { frameRate: { ideal: 15, max: 15 }, displaySurface: 'browser' },
      selfBrowserSurface: 'include', audio: false, preferCurrentTab: true });
    expect(send).not.toHaveBeenCalled();
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'watch.signal', payload: { watchId: 'watch-1', description: { type: 'offer', sdp: 'screen-offer' } } }));
    expect(send.mock.calls[0][0]).toEqual({ type: 'watch.accept', payload: { watchId: 'watch-1' } });
    expect(track.contentHint).toBe('detail');
    fireEvent.click(screen.getByRole('button', { name: '止める' }));
    expect(MockPeerConnection.instances[0].close).toHaveBeenCalledOnce(); expect(track.stop).toHaveBeenCalledOnce();
  });
  it('buffers a pre-accept offer, answers it, and attaches the received stream', async () => {
    render(<ScreenWatchHost clientKey="device" />);
    await act(() => startWatch('thread', 'badge', '加工キオスク'));
    act(() => publishSignaling({ type: 'watch.signal', payload: { watchId: 'watch-1', description: { type: 'offer', sdp: 'remote' } } }));
    expect(MockPeerConnection.instances).toHaveLength(0);
    receive('watch.accepted');
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'watch.signal', payload: { watchId: 'watch-1', description: { type: 'answer', sdp: 'screen-answer' } } }));
    const { stream } = mockStream();
    act(() => MockPeerConnection.instances[0].ontrack?.({ track: stream.getTracks()[0], streams: [stream] }));
    const video = screen.getByLabelText('画面の映像') as HTMLVideoElement;
    expect(video.srcObject).toBe(stream); expect(video.muted).toBe(true);
    expect(video).toHaveAttribute('autoplay'); expect(video).toHaveAttribute('playsinline');
  });
  it.each(['stopped', 'denied', 'disconnect', 'unmount', 'local'] as const)('cleans up the viewer on %s', async ending => {
    const { unmount } = render(<ScreenWatchHost clientKey="device" />); await accept();
    const pc = MockPeerConnection.instances[0]; const { stream, track } = mockStream();
    act(() => pc.ontrack?.({ track: stream.getTracks()[0], streams: [stream] }));
    if (ending === 'unmount') unmount();
    else if (ending === 'disconnect') act(() => release());
    else if (ending === 'local') fireEvent.click(screen.getByRole('button', { name: '■ 止める' }));
    else receive(ending === 'denied' ? 'watch.denied' : 'watch.stopped');
    expect(pc.close).toHaveBeenCalledOnce(); expect(track.stop).toHaveBeenCalledOnce();
  });
  it('shows video failure and ends when the viewer peer fails', async () => {
    render(<ScreenWatchHost clientKey="device" />); await accept();
    const pc = MockPeerConnection.instances[0];
    act(() => { pc.connectionState = 'failed'; pc.onconnectionstatechange?.(); });
    expect(screen.getByRole('status')).toHaveTextContent('映像が届きませんでした');
    expect(send).toHaveBeenLastCalledWith({ type: 'watch.stop', payload: { watchId: 'watch-1' } });
  });
  it('toggles pointing, ignores letterboxes, throttles taps and shows a local ring', async () => {
    render(<ScreenWatchHost clientKey="device" />); await accept();
    const video = screen.getByLabelText('画面の映像');
    Object.defineProperties(video, { videoWidth: { value: 400 }, videoHeight: { value: 200 } });
    vi.spyOn(video, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 400 } as DOMRect);
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    fireEvent.click(video, { clientX: 100, clientY: 150 }); expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '指さし' }));
    expect(screen.getByRole('button', { name: '指さし' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(video, { clientX: 100, clientY: 50 }); expect(send).not.toHaveBeenCalled();
    fireEvent.click(video, { clientX: 100, clientY: 150 });
    expect(send).toHaveBeenLastCalledWith({ type: 'watch.pointer', payload: { watchId: 'watch-1', x: .25, y: .25 } });
    expect(screen.getByTestId('screen-watch-pointer')).toHaveStyle({ left: '100px', top: '150px', pointerEvents: 'none' });
    fireEvent.click(video, { clientX: 200, clientY: 200 }); expect(send).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1100); fireEvent.click(video, { clientX: 200, clientY: 200 }); expect(send).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });
  it('shows and replaces a nonblocking target ring, validates coordinates and hides after 2.5s', async () => {
    vi.useFakeTimers();
    render(<ScreenWatchHost clientKey="device" startCapture={async () => mockStream().stream} />); receive('watch.request');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '見せる' })));
    const point = (x: number, y: number) => act(() => publishSignaling({ type: 'watch.pointer', payload: { watchId: 'watch-1', x, y } }));
    point(-1, .5); expect(screen.queryByTestId('screen-watch-pointer')).not.toBeInTheDocument();
    point(.25, .75); expect(screen.getByTestId('screen-watch-pointer')).toHaveStyle({ left: '25vw', top: '75vh', pointerEvents: 'none' });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    point(.5, .5); expect(screen.getAllByTestId('screen-watch-pointer')).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(2499)); expect(screen.getByTestId('screen-watch-pointer')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1)); expect(screen.queryByTestId('screen-watch-pointer')).not.toBeInTheDocument();
  });
  it('shows selected-pair delay', async () => {
    vi.useFakeTimers(); render(<ScreenWatchHost clientKey="device" />); await accept();
    expect(screen.getByText('—')).toBeInTheDocument();
    MockPeerConnection.instances[0].getStats.mockResolvedValue(new Map([
      ['pair', { type: 'candidate-pair', selected: true, currentRoundTripTime: .12 }]
    ]));
    await act(() => vi.advanceTimersByTimeAsync(2000)); expect(screen.getByText('0.1秒')).toBeInTheDocument();
  });
});
