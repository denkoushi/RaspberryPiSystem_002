import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clientKey: 'client-key-test',
  auth: { user: null, token: null },
  send: vi.fn()
}));

vi.mock('../../api/client', () => ({
  getResolvedClientKey: () => mocks.clientKey,
  sendBusinessHermesChat: mocks.send
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mocks.auth
}));

vi.mock('./HermesChatPanel', () => ({
  default: (props: {
    messages: Array<{ id: string; content: string; evidence?: ReadonlyArray<{ id: string; title: string }> }>;
    draft: string;
    isBusy: boolean;
    error: string | null;
    onDraftChange: (value: string) => void;
    onSend: () => void;
    onReset: () => void;
    onClose: () => void;
  }) => (
    <section data-testid="hermes-panel">
      {props.messages.map((message) => (
        <div key={message.id}>
          <p>{message.content}</p>
          {message.evidence?.map((evidence) => <p key={evidence.id}>{evidence.title}</p>)}
        </div>
      ))}
      {props.error ? <p role="alert">{props.error}</p> : null}
      <input
        aria-label="Hermesへの質問"
        value={props.draft}
        onChange={(event) => props.onDraftChange(event.target.value)}
      />
      <button type="button" onClick={props.onSend} disabled={props.isBusy}>送信</button>
      <button type="button" onClick={props.onReset}>リセット</button>
      <button type="button" onClick={props.onClose}>閉じる</button>
    </section>
  )
}));

import { HermesFloatingChat } from './HermesFloatingChat';

function renderChat() {
  return render(
    <MemoryRouter initialEntries={['/kiosk/assembly']}>
      <HermesFloatingChat />
    </MemoryRouter>
  );
}

describe('HermesFloatingChat', () => {
  beforeEach(() => {
    mocks.clientKey = 'client-key-test';
    mocks.auth.user = null;
    mocks.auth.token = null;
    mocks.send.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens from the keyboard and moves within the viewport with arrow keys', async () => {
    renderChat();
    const trigger = screen.getByRole('button', { name: /業務Hermesチャットを開く/ });
    const initialLeft = trigger.getBoundingClientRect().left;

    fireEvent.keyDown(trigger, { key: 'ArrowLeft' });
    expect(Number.parseInt(trigger.getAttribute('style')?.match(/left: ([^;]+)/)?.[1] ?? '', 10)).toBeLessThan(initialLeft || 1000);
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(await screen.findByTestId('hermes-panel')).toBeInTheDocument();
  });

  it('separates a drag from a click', async () => {
    renderChat();
    const trigger = screen.getByRole('button', { name: /業務Hermesチャットを開く/ });
    const initialLeft = trigger.style.left;
    const dispatchPointer = (type: string, init: { clientX: number; clientY: number; pointerId: number }) => {
      const event = new Event(type, { bubbles: true });
      Object.assign(event, init);
      trigger.dispatchEvent(event);
    };
    act(() => {
      dispatchPointer('pointerdown', { pointerId: 1, clientX: 900, clientY: 700 });
      dispatchPointer('pointermove', { pointerId: 1, clientX: 760, clientY: 620 });
      dispatchPointer('pointerup', { pointerId: 1, clientX: 760, clientY: 620 });
    });
    expect(screen.queryByTestId('hermes-panel')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger.style.left).not.toBe(initialLeft));
  });

  it('sends plain text history and drops an in-flight response after reset', async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;
    const request = new Promise((resolve) => {
      resolveRequest = resolve;
    });
    mocks.send.mockReturnValue(request);
    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    const input = await screen.findByRole('textbox', { name: 'Hermesへの質問' });
    fireEvent.change(input, { target: { value: '<script>現場質問</script>' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
    expect(mocks.send.mock.calls[0][0].messages.at(-1)).toEqual({
      role: 'user',
      content: '<script>現場質問</script>'
    });
    fireEvent.click(screen.getByRole('button', { name: 'リセット' }));
    resolveRequest?.({
      status: 'ready',
      message: '遅延した回答',
      evidence: [],
      partNumber: null,
      shootingTarget: null,
      needsClarification: false,
      clarificationMessage: null
    });
    await waitFor(() => expect(screen.queryByText('遅延した回答')).not.toBeInTheDocument());
  });

  it('drops the old conversation when the client key changes during a request', async () => {
    let resolveOldRequest: ((value: unknown) => void) | undefined;
    const oldRequest = new Promise((resolve) => {
      resolveOldRequest = resolve;
    });
    mocks.send
      .mockReturnValueOnce(oldRequest)
      .mockResolvedValueOnce({
        status: 'ready',
        message: '新端末の回答',
        evidence: [],
        partNumber: null,
        shootingTarget: null,
        needsClarification: false,
        clarificationMessage: null
      });

    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    const input = await screen.findByRole('textbox', { name: 'Hermesへの質問' });
    fireEvent.change(input, { target: { value: '旧端末での質問' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());

    mocks.clientKey = 'client-key-next';
    act(() => window.dispatchEvent(new Event('storage')));
    await waitFor(() => expect(screen.getByText(/品番が分からないときも/)).toBeInTheDocument());

    resolveOldRequest?.({
      status: 'ready',
      message: '旧端末の遅延回答',
      evidence: [],
      partNumber: null,
      shootingTarget: null,
      needsClarification: false,
      clarificationMessage: null
    });
    await waitFor(() => expect(screen.queryByText('旧端末の遅延回答')).not.toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox', { name: 'Hermesへの質問' }), { target: { value: '新端末での質問' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    expect(mocks.send.mock.calls[1][0].messages).toEqual([
      { role: 'user', content: '新端末での質問' }
    ]);
    expect(await screen.findByText('新端末の回答')).toBeInTheDocument();
  });

  it('keeps evidence visible and surfaces an error when generation is unavailable', async () => {
    mocks.send.mockResolvedValue({
      status: 'unavailable',
      message: null,
      evidence: [{ id: 'wi-1', title: '作業要領 手順1' }],
      partNumber: 'MD004121632-021',
      shootingTarget: 'ボルト締結部',
      needsClarification: false,
      clarificationMessage: null
    });

    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    const input = await screen.findByRole('textbox', { name: 'Hermesへの質問' });
    fireEvent.change(input, { target: { value: '作業要領を見せて' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));

    expect(await screen.findByText('作業要領 手順1')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('回答生成が利用できないため');
    expect(screen.getByText(/検索結果は取得できましたが、Hermesの回答生成は利用できません/)).toBeInTheDocument();
  });
});
