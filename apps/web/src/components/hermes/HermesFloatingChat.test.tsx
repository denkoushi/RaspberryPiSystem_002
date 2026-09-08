import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clientKey: 'client-key-test',
  auth: { user: null, token: null },
  send: vi.fn(),
  listConsultations: vi.fn(),
  createConsultation: vi.fn(),
  getConsultation: vi.fn(),
  sendConsultationMessage: vi.fn(),
  updateConsultation: vi.fn(),
  cancelConsultation: vi.fn()
}));

vi.mock('../../api/client', () => ({
  getResolvedClientKey: () => mocks.clientKey,
  cancelBusinessHermesConsultation: mocks.cancelConsultation,
  createBusinessHermesConsultation: mocks.createConsultation,
  getBusinessHermesConsultation: mocks.getConsultation,
  listBusinessHermesConsultations: mocks.listConsultations,
  sendBusinessHermesChat: mocks.send,
  sendBusinessHermesConsultationMessage: mocks.sendConsultationMessage,
  updateBusinessHermesConsultation: mocks.updateConsultation
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mocks.auth
}));

vi.mock('./HermesChatPanel', () => ({
  default: (props: {
    mode?: 'legacy' | 'consultations';
    messages: Array<{ id: string; content: string; evidence?: ReadonlyArray<{ id: string; title: string }> }>;
    draft: string;
    isBusy: boolean;
    isConsultationsLoading?: boolean;
    isConsultationDetailLoading?: boolean;
    isMessageHistoryLoading?: boolean;
    error: string | null;
    consultationError?: string | null;
    consultations?: Array<{ id: string; title: string }>;
    activeConsultation?: { id: string; title: string; messages: Array<{ id: string; content: string }>; messagesNextCursor?: string | null } | null;
    onDraftChange: (value: string) => void;
    onSend: () => void;
    onReset: () => void;
    onClose: () => void;
    onStop?: () => void;
    isExpanded?: boolean;
    onToggleSize?: () => void;
    onNewConsultation?: () => void;
    onSelectConsultation?: (consultationId: string) => void;
    onLoadOlderMessages?: () => void;
    onScan?: () => void;
    suggestion?: { title?: string; relatedIdentifiers: string[]; prompt: string; options?: string[] } | null;
    onAnswerSuggestion?: (answer: string) => void;
    selectionNotice?: string | null;
    activityStatus?: string | null;
    style?: CSSProperties;
  }) => (
    <section data-testid="hermes-panel" style={props.style}>
      {props.mode === 'consultations' && props.onNewConsultation ? (
        <button type="button" onClick={props.onNewConsultation}>新規</button>
      ) : null}
      {props.mode === 'consultations' && props.onScan ? (
        <button
          type="button"
          onClick={props.onScan}
          disabled={props.isBusy || props.isConsultationsLoading || props.isConsultationDetailLoading || props.isMessageHistoryLoading}
        >Scan</button>
      ) : null}
      {props.mode === 'consultations' && !props.activeConsultation ? (
        <div data-testid="consultation-list">
          {props.consultations?.map((consultation) => (
            <button key={consultation.id} type="button" onClick={() => props.onSelectConsultation?.(consultation.id)}>
              {`相談を開く: ${consultation.title}`}
            </button>
          ))}
        </div>
      ) : null}
      {props.activeConsultation ? <h2>{props.activeConsultation.title}</h2> : null}
      {props.suggestion ? (
        <div role="group" aria-label="Hermesからの候補確認">
          <p>{props.suggestion.prompt}</p>
          {props.suggestion.options?.map(option => <button key={option} type="button" onClick={() => props.onAnswerSuggestion?.(option)}>{option}</button>)}
        </div>
      ) : null}
      {props.selectionNotice ? <p role="status">{props.selectionNotice}</p> : null}
      {props.activityStatus ? <p role="status">{props.activityStatus}</p> : null}
      {props.isConsultationDetailLoading ? <p role="status">相談内容を読み込んでいます…</p> : null}
      {props.activeConsultation?.messagesNextCursor ? (
        <button type="button" onClick={props.onLoadOlderMessages} disabled={props.isMessageHistoryLoading}>
          {props.isMessageHistoryLoading ? '以前の履歴を読み込んでいます…' : '以前の履歴を読み込む'}
        </button>
      ) : null}
      {props.messages.map((message) => (
        <div key={message.id}>
          <p>{message.content}</p>
          {message.evidence?.map((evidence) => <p key={evidence.id}>{evidence.title}</p>)}
        </div>
      ))}
      {props.error ? <p role="alert">{props.error}</p> : null}
      {props.consultationError ? <p role="alert">{props.consultationError}</p> : null}
      <input
        aria-label="Hermesへの質問"
        value={props.draft}
        onChange={(event) => props.onDraftChange(event.target.value)}
      />
      <button type="button" onClick={props.onSend} disabled={props.isBusy}>送信</button>
      {props.isBusy && props.onStop ? <button type="button" onClick={props.onStop}>停止</button> : null}
      <button type="button" onClick={props.onReset}>{props.activeConsultation ? '相談一覧に戻る' : 'リセット'}</button>
      <button type="button" onClick={props.onClose}>閉じる</button>
      {props.onToggleSize ? <button type="button" onClick={props.onToggleSize}>{props.isExpanded ? '標準' : '拡大'}</button> : null}
    </section>
  )
}));

const dispatchWedgeScan = (value: string, target: EventTarget = document.activeElement ?? window) => {
  for (const character of value) {
    fireEvent.keyDown(target, { key: character });
  }
  fireEvent.keyDown(target, { key: 'Enter' });
};

import { HermesFloatingChat } from './HermesFloatingChat';

import type { CSSProperties } from 'react';

function renderChat() {
  return render(
    <MemoryRouter initialEntries={['/kiosk/assembly']}>
      <HermesFloatingChat />
    </MemoryRouter>
  );
}

function consultation(id: string, title = id) {
  return {
    id,
    title,
    relatedIdentifiers: [],
    confirmedFacts: [],
    openQuestions: [],
    summary: '',
    updatedAt: '2026-09-07T00:00:00.000Z'
  };
}

function detail(
  id: string,
  messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; confirmation?: { prompt: string; options?: string[] } }> = [],
  messagesNextCursor: string | null = null
) {
  return { ...consultation(id), messages, messagesNextCursor };
}

function consultationResponse(
  item: ReturnType<typeof consultation>,
  messages: Array<{ id: string; role: 'user' | 'assistant'; content: string }>,
  confirmation?: { prompt: string; options?: string[]; title?: string; relatedIdentifiers?: string[] }
) {
  return {
    status: 'ready' as const,
    message: messages.at(-1)?.content ?? null,
    evidence: [],
    partNumber: null,
    shootingTarget: null,
    needsClarification: false,
    clarificationMessage: null,
    consultationId: item.id,
    consultation: { ...item, messages },
    ...(confirmation ? { confirmation } : {})
  };
}

describe('HermesFloatingChat', () => {
  beforeEach(() => {
    mocks.clientKey = 'client-key-test';
    mocks.auth.user = null;
    mocks.auth.token = null;
    mocks.send.mockReset();
    mocks.listConsultations.mockReset();
    mocks.listConsultations.mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
    mocks.createConsultation.mockReset();
    mocks.getConsultation.mockReset();
    mocks.sendConsultationMessage.mockReset();
    mocks.updateConsultation.mockReset();
    mocks.cancelConsultation.mockReset().mockResolvedValue(undefined);
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

  it('toggles the panel between standard and expanded sizes without clearing the draft', async () => {
    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    const panel = await screen.findByTestId('hermes-panel');
    const input = screen.getByRole('textbox', { name: 'Hermesへの質問' });
    fireEvent.change(input, { target: { value: '入力中の質問' } });

    expect(panel.style.width).toBe('380px');
    expect(panel.style.height).toBe('560px');
    fireEvent.click(screen.getByRole('button', { name: '拡大' }));
    await waitFor(() => expect(panel.style.width).toBe('760px'));
    expect(panel.style.height).toBe('744px');
    expect(input).toHaveValue('入力中の質問');
    expect(Number.parseFloat(panel.style.left) + Number.parseFloat(panel.style.width)).toBeLessThanOrEqual(window.innerWidth - 12);
    expect(Number.parseFloat(panel.style.top) + Number.parseFloat(panel.style.height)).toBeLessThanOrEqual(window.innerHeight - 12);

    fireEvent.click(screen.getByRole('button', { name: '標準' }));
    await waitFor(() => expect(panel.style.width).toBe('380px'));
    expect(panel.style.height).toBe('560px');
    expect(input).toHaveValue('入力中の質問');
  });

  it('clamps the expanded panel to a small viewport', async () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 240 });
    try {
      renderChat();
      fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
      const panel = await screen.findByTestId('hermes-panel');
      fireEvent.click(screen.getByRole('button', { name: '拡大' }));
      await waitFor(() => expect(panel.style.width).toBe('296px'));
      expect(panel.style.height).toBe('216px');
      expect(Number.parseFloat(panel.style.left)).toBeGreaterThanOrEqual(12);
      expect(Number.parseFloat(panel.style.top)).toBeGreaterThanOrEqual(12);
      expect(Number.parseFloat(panel.style.left) + Number.parseFloat(panel.style.width)).toBeLessThanOrEqual(308);
      expect(Number.parseFloat(panel.style.top) + Number.parseFloat(panel.style.height)).toBeLessThanOrEqual(228);
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
    }
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
    await waitFor(() => expect(screen.getByText('ご相談をどうぞ。')).toBeInTheDocument());

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

  it('keeps the legacy chat when the consultation capability is disabled', async () => {
    mocks.listConsultations.mockResolvedValue({ consultations: [], enabled: false });
    mocks.send.mockResolvedValue({
      status: 'ready',
      message: '旧チャットの回答',
      evidence: [],
      partNumber: null,
      shootingTarget: null,
      needsClarification: false,
      clarificationMessage: null
    });

    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    await waitFor(() => expect(screen.queryByTestId('consultation-list')).not.toBeInTheDocument());
    fireEvent.change(screen.getByRole('textbox', { name: 'Hermesへの質問' }), { target: { value: '旧方式で質問' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));

    await waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
    expect(mocks.createConsultation).not.toHaveBeenCalled();
    expect(await screen.findByText('旧チャットの回答')).toBeInTheDocument();
  });

  it('creates a consultation automatically when natural text starts from the list', async () => {
    const created = detail('case-natural');
    mocks.listConsultations.mockImplementation(async () => ({ consultations: [], enabled: true }));
    mocks.createConsultation.mockResolvedValue(created);
    mocks.sendConsultationMessage.mockResolvedValue(consultationResponse(created, [
      { id: 'user-1', role: 'user', content: '品番が分からない不適合を相談したい' },
      { id: 'assistant-1', role: 'assistant', content: '確認したい状況を教えてください。' }
    ]));

    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    await screen.findByTestId('consultation-list');
    const input = screen.getByRole('textbox', { name: 'Hermesへの質問' });
    fireEvent.change(input, { target: { value: '品番が分からない不適合を相談したい' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));

    await waitFor(() => expect(mocks.createConsultation).toHaveBeenCalledOnce());
    expect(mocks.sendConsultationMessage).toHaveBeenCalledWith(
      { consultationId: 'case-natural', message: '品番が分からない不適合を相談したい' },
      expect.any(AbortSignal)
    );
    expect(await screen.findByText('確認したい状況を教えてください。')).toBeInTheDocument();
  });

  it('opens the existing scanner and sends its resolved value into a new consultation', async () => {
    const created = detail('case-scan');
    mocks.listConsultations.mockImplementation(async () => ({ consultations: [], enabled: true }));
    mocks.createConsultation.mockResolvedValue(created);
    mocks.sendConsultationMessage.mockResolvedValue(consultationResponse(created, [
      { id: 'scan-answer', role: 'assistant', content: 'スキャン対象を確認します。' }
    ]));

    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    await screen.findByTestId('consultation-list');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Scan' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }));
    expect(await screen.findByRole('dialog', { name: 'バーコードをスキャン' })).toBeInTheDocument();
    const scanStatus = screen.getByText('バーコードリーダーで移動票または部品番号を読み取ってください。');
    expect(scanStatus).toHaveFocus();
    dispatchWedgeScan('SCAN-ORDER-1', scanStatus);

    await waitFor(() => expect(mocks.sendConsultationMessage).toHaveBeenCalledWith({
      consultationId: 'case-scan',
      message: 'バーコードの照合結果を確認してください。',
      scanValue: 'SCAN-ORDER-1'
    }, expect.any(AbortSignal)));
    expect(screen.queryByRole('dialog', { name: 'バーコードをスキャン' })).not.toBeInTheDocument();
  });

  it('closes the scanner without sending a consultation when the operator cancels', async () => {
    mocks.listConsultations.mockResolvedValue({ consultations: [], enabled: true });

    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    await screen.findByTestId('consultation-list');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Scan' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }));
    await screen.findByRole('dialog', { name: 'バーコードをスキャン' });
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'バーコードをスキャン' })).not.toBeInTheDocument());
    expect(mocks.createConsultation).not.toHaveBeenCalled();
    expect(mocks.sendConsultationMessage).not.toHaveBeenCalled();
  });

  it('releases the scanner when Escape closes the chat', async () => {
    mocks.listConsultations.mockImplementation(async () => ({ consultations: [], enabled: true }));

    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    await screen.findByTestId('consultation-list');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Scan' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }));
    await screen.findByRole('dialog', { name: 'バーコードをスキャン' });
    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'バーコードをスキャン' })).not.toBeInTheDocument());
    expect(screen.queryByTestId('hermes-panel')).not.toBeInTheDocument();
  });

  it('sends candidate yes or no as natural conversation and does not revive a rejected candidate on reopen', async () => {
    const item = consultation('case-candidate', '候補を確認する相談');
    const initial = detail(item.id, [{ id: 'initial', role: 'assistant', content: '対象を確認します。' }]);
    const candidate = { ...item, relatedIdentifiers: ['PN-A-204'], title: '締結部の確認' };
    const rejectedMessages = [
      { id: 'question', role: 'user' as const, content: '写真を見てください' },
      { id: 'candidate-answer', role: 'assistant' as const, content: '候補を見つけました。' },
      { id: 'reject', role: 'user' as const, content: 'いいえ。締結部の確認・PN-A-204は違います。このあと自然な言葉で正しい内容を伝えます。' },
      { id: 'reject-answer', role: 'assistant' as const, content: '承知しました。正しい内容を自然な言葉で教えてください。' }
    ];
    mocks.listConsultations.mockResolvedValue({ consultations: [item], enabled: true });
    mocks.getConsultation.mockResolvedValue(initial);
    mocks.sendConsultationMessage
      .mockResolvedValueOnce(consultationResponse(candidate, [
        { id: 'question', role: 'user', content: '写真を見てください' },
      { id: 'candidate-answer', role: 'assistant', content: '候補を見つけました。' }
      ], {
        prompt: 'Hermesが明示した候補で相談を続けますか？', options: ['はい', 'いいえ'],
        title: '締結部の確認',
        relatedIdentifiers: ['PN-A-204']
      }))
      .mockResolvedValueOnce(consultationResponse(candidate, rejectedMessages));

    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    fireEvent.click(await screen.findByRole('button', { name: '相談を開く: 候補を確認する相談' }));
    await screen.findByText('対象を確認します。');
    fireEvent.change(screen.getByRole('textbox', { name: 'Hermesへの質問' }), { target: { value: '写真を見てください' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    expect(await screen.findByRole('group', { name: 'Hermesからの候補確認' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'いいえ' }));
    await waitFor(() => expect(mocks.sendConsultationMessage).toHaveBeenCalledTimes(2));
    expect(mocks.sendConsultationMessage.mock.calls[1][0]).toEqual({
      consultationId: item.id,
      message: 'いいえ',
      selection: { prompt: 'Hermesが明示した候補で相談を続けますか？', option: 'いいえ' }
    });
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Hermesからの候補確認' })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '相談一覧に戻る' }));
    mocks.getConsultation.mockResolvedValue(detail(item.id, rejectedMessages));
    fireEvent.click(await screen.findByRole('button', { name: '相談を開く: 締結部の確認' }));
    await screen.findByText('承知しました。正しい内容を自然な言葉で教えてください。');
    expect(screen.queryByRole('group', { name: 'Hermesからの候補確認' })).not.toBeInTheDocument();
  });

  it('passes the explicit confirmation option with the question', async () => {
    const item = consultation('case-prompt-only', '組立後の確認');
    const created = detail(item.id);
    mocks.listConsultations.mockResolvedValue({ consultations: [], enabled: true });
    mocks.createConsultation.mockResolvedValue(created);
    mocks.sendConsultationMessage.mockResolvedValueOnce(consultationResponse(item, [
      { id: 'question', role: 'user', content: '漏れについて相談したい' },
      { id: 'answer', role: 'assistant', content: '組立後の状態を確認します。' }
    ], {
      prompt: '漏れが見つかったのは組立後ですか？', options: ['はい', 'いいえ']
    })).mockResolvedValueOnce(consultationResponse(item, [
      { id: 'question', role: 'user', content: '漏れについて相談したい' },
      { id: 'answer', role: 'assistant', content: '組立後の状態を確認します。' },
      { id: 'follow-up', role: 'assistant', content: '組立後の漏れとして追加確認を進めます。' }
    ]));

    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    const input = await screen.findByRole('textbox', { name: 'Hermesへの質問' });
    fireEvent.change(input, { target: { value: '漏れについて相談したい' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    fireEvent.click(await screen.findByRole('button', { name: 'はい' }));

    await waitFor(() => expect(mocks.sendConsultationMessage).toHaveBeenCalledTimes(2));
    expect(mocks.sendConsultationMessage.mock.calls[1][0]).toEqual({
      consultationId: item.id,
      message: 'はい',
      selection: { prompt: '漏れが見つかったのは組立後ですか？', option: 'はい' }
    });
    expect(await screen.findByText('組立後の漏れとして追加確認を進めます。')).toBeInTheDocument();
  });

  it('shows selection and processing statuses separately and clears both after completion', async () => {
    const item = consultation('case-selection-status', '選択状態の相談');
    const created = detail(item.id);
    let resolveSelection!: (value: unknown) => void;
    const pendingSelection = new Promise((resolve) => { resolveSelection = resolve; });
    mocks.listConsultations.mockResolvedValue({ consultations: [], enabled: true });
    mocks.createConsultation.mockResolvedValue(created);
    mocks.sendConsultationMessage
      .mockResolvedValueOnce(consultationResponse(item, [
        { id: 'question', role: 'user', content: '漏れについて相談したい' },
        { id: 'answer', role: 'assistant', content: '組立後の状態を確認します。' }
      ], { prompt: '漏れが見つかったのは組立後ですか？', options: ['はい', 'いいえ'] }))
      .mockReturnValueOnce(pendingSelection);

    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Hermesへの質問' }), { target: { value: '漏れについて相談したい' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    fireEvent.click(await screen.findByRole('button', { name: 'はい' }));

    expect(await screen.findByText('「はい」が選択されました。')).toBeInTheDocument();
    expect(screen.getByText('確認中です。しばらくお待ちください。')).toBeInTheDocument();
    expect(screen.queryByText(/への回答は「はい」です/)).not.toBeInTheDocument();

    resolveSelection?.(consultationResponse(item, [
      { id: 'question', role: 'user', content: '漏れについて相談したい' },
      { id: 'answer', role: 'assistant', content: '組立後の状態を確認します。' },
      { id: 'selected', role: 'user', content: '「はい」が選択されました。' },
      { id: 'follow-up', role: 'assistant', content: '組立後として確認します。' }
    ]));
    await waitFor(() => expect(screen.queryByText('確認中です。しばらくお待ちください。')).not.toBeInTheDocument());
  });

  it('reopens a consultation and renders its persisted history', async () => {
    const item = consultation('case-reopen', '翌日の相談');
    mocks.listConsultations.mockResolvedValue({ consultations: [item], enabled: true });
    mocks.getConsultation.mockResolvedValue(detail(item.id, [
      { id: 'old-user', role: 'user', content: '昨日の確認です' },
      { id: 'old-assistant', role: 'assistant', content: '昨日の回答です', confirmation: { prompt: '組立後に見つかった漏れですか？', options: ['はい', 'いいえ'] } }
    ]));

    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    fireEvent.click(await screen.findByRole('button', { name: '相談を開く: 翌日の相談' }));

    expect(mocks.getConsultation).toHaveBeenCalledWith('case-reopen');
    expect(await screen.findByText('昨日の回答です')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Hermesからの候補確認' })).toHaveTextContent('組立後に見つかった漏れですか？');
    expect(screen.getByRole('button', { name: 'はい' })).toBeEnabled();
  });

  it('loads older consultation history above the initial page', async () => {
    const item = consultation('case-history', '履歴を続けて見る相談');
    mocks.listConsultations.mockResolvedValue({ consultations: [item], enabled: true });
    mocks.getConsultation
      .mockResolvedValueOnce(detail(item.id, [
        { id: 'newer-user', role: 'user', content: '最新の質問' },
        { id: 'newer-answer', role: 'assistant', content: '最新の回答' }
      ], 'older-cursor'))
      .mockResolvedValueOnce(detail(item.id, [
        { id: 'older-user', role: 'user', content: '以前の質問' },
        { id: 'older-answer', role: 'assistant', content: '以前の回答' }
      ]));

    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    fireEvent.click(await screen.findByRole('button', { name: '相談を開く: 履歴を続けて見る相談' }));
    expect(await screen.findByText('最新の回答')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '以前の履歴を読み込む' }));
    expect(await screen.findByText('以前の回答')).toBeInTheDocument();
    expect(mocks.getConsultation).toHaveBeenLastCalledWith('case-history', 'older-cursor', expect.any(AbortSignal));
  });

  it('keeps new chat metadata when an older history page resolves late', async () => {
    const item = consultation('case-history-race', '現在の相談名');
    let resolveOlder: ((value: unknown) => void) | undefined;
    const pendingOlder = new Promise((resolve) => { resolveOlder = resolve; });
    mocks.listConsultations.mockResolvedValue({ consultations: [item], enabled: true });
    mocks.getConsultation
      .mockResolvedValueOnce(detail(item.id, [{ id: 'newest', role: 'assistant', content: '現在の履歴' }], 'older-cursor'))
      .mockReturnValueOnce(pendingOlder);
    mocks.sendConsultationMessage.mockResolvedValue(consultationResponse(
      { ...item, title: '新しい相談名', summary: '新しい要約' },
      [{ id: 'chat-answer', role: 'assistant', content: '新しいchat応答' }]
    ));

    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    fireEvent.click(await screen.findByRole('button', { name: '相談を開く: 現在の相談名' }));
    await screen.findByText('現在の履歴');
    fireEvent.click(screen.getByRole('button', { name: '以前の履歴を読み込む' }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Hermesへの質問' }), { target: { value: '新しい質問' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    expect(await screen.findByText('新しいchat応答')).toBeInTheDocument();

    resolveOlder?.(detail(item.id, [{ id: 'older', role: 'assistant', content: '古い履歴' }], 'oldest-cursor'));
    expect(await screen.findByText('古い履歴')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '新しい相談名' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '現在の相談名' })).not.toBeInTheDocument();
  });

  it('drops a delayed answer from the old consultation after switching cases', async () => {
    const first = consultation('case-a', '案件A');
    const second = consultation('case-b', '案件B');
    let resolveOld: ((value: unknown) => void) | undefined;
    const oldRequest = new Promise((resolve) => { resolveOld = resolve; });
    mocks.listConsultations.mockResolvedValue({ consultations: [first, second], enabled: true });
    mocks.getConsultation.mockImplementation(async (id: string) => detail(id, [{
      id: `${id}-history`,
      role: 'assistant',
      content: `${id}の履歴`
    }]));
    mocks.sendConsultationMessage.mockReturnValue(oldRequest);

    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    fireEvent.click(await screen.findByRole('button', { name: '相談を開く: 案件A' }));
    await screen.findByText('case-aの履歴');
    fireEvent.change(screen.getByRole('textbox', { name: 'Hermesへの質問' }), { target: { value: '案件Aへの質問' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    await waitFor(() => expect(mocks.sendConsultationMessage).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('button', { name: '相談一覧に戻る' }));
    fireEvent.click(await screen.findByRole('button', { name: '相談を開く: 案件B' }));
    expect(await screen.findByText('case-bの履歴')).toBeInTheDocument();
    resolveOld?.(consultationResponse(first, [{ id: 'late', role: 'assistant', content: '案件Aの遅延回答' }]));
    await waitFor(() => expect(screen.queryByText('案件Aの遅延回答')).not.toBeInTheDocument());
  });

  it('stops a request and allows the consultation to be sent again', async () => {
    const item = consultation('case-stop', '停止できる相談');
    const firstRequest = new Promise(() => undefined);
    mocks.listConsultations.mockResolvedValue({ consultations: [], enabled: true });
    mocks.createConsultation.mockResolvedValue({ ...item, messages: [] });
    mocks.sendConsultationMessage
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValueOnce(consultationResponse(item, [
        { id: 'retry-answer', role: 'assistant', content: '再送後の回答です' }
      ]));

    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    fireEvent.click(await screen.findByRole('button', { name: '新規' }));
    await screen.findByText('停止できる相談');
    fireEvent.change(screen.getByRole('textbox', { name: 'Hermesへの質問' }), { target: { value: '最初の質問' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    expect(screen.getByRole('alert')).toHaveTextContent('回答を中止しました');
    expect(mocks.cancelConsultation).toHaveBeenCalledWith(item.id);
    await waitFor(() => expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox', { name: 'Hermesへの質問' }), { target: { value: 'もう一度質問' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    expect(await screen.findByText('再送後の回答です')).toBeInTheDocument();
    expect(mocks.sendConsultationMessage).toHaveBeenCalledTimes(2);
  });

  it('clears a detail spinner when identity changes during consultation loading', async () => {
    const item = consultation('case-loading', '認証切替相談');
    let resolveDetail: ((value: unknown) => void) | undefined;
    const pendingDetail = new Promise((resolve) => { resolveDetail = resolve; });
    mocks.listConsultations.mockResolvedValue({ consultations: [item], enabled: true });
    mocks.getConsultation.mockReturnValue(pendingDetail);

    const view = renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    fireEvent.click(await screen.findByRole('button', { name: '相談を開く: 認証切替相談' }));
    expect(await screen.findByText('相談内容を読み込んでいます…')).toBeInTheDocument();

    mocks.auth.token = 'token-next';
    view.rerender(
      <MemoryRouter initialEntries={['/kiosk/assembly']}>
        <HermesFloatingChat />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.queryByText('相談内容を読み込んでいます…')).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: '新規' })).toBeInTheDocument();
    resolveDetail?.(detail(item.id, [{ id: 'late-detail', role: 'assistant', content: '旧identityの詳細' }]));
    await waitFor(() => expect(screen.queryByText('旧identityの詳細')).not.toBeInTheDocument());
  });
});
