import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render as testingRender, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clientKey: 'client-key-test',
  poster: { tagUid: 'tag-1', name: '田中' },
  auth: { user: null, token: null },
  send: vi.fn(),
  getTrialScope: vi.fn(),
  sendTrialAnswer: vi.fn(),
  listConsultations: vi.fn(),
  createConsultation: vi.fn(),
  getConsultation: vi.fn(),
  sendConsultationMessage: vi.fn(),
  updateConsultation: vi.fn(),
  cancelConsultation: vi.fn(),
  knowledgeGet: vi.fn(),
  knowledgePost: vi.fn(),
  pendingReviews: vi.fn(),
  inquirySummary: vi.fn(),
  inquiryList: vi.fn()
}));

vi.mock('../../api/client', () => ({
  getResolvedClientKey: () => mocks.clientKey,
  getKioskInquirySummary: mocks.inquirySummary,
  listKioskInquiries: mocks.inquiryList,
  openKioskInquiry: vi.fn(),
  replyToKioskInquiry: vi.fn(),
  cancelBusinessHermesConsultation: mocks.cancelConsultation,
  createBusinessHermesConsultation: mocks.createConsultation,
  getBusinessHermesConsultation: mocks.getConsultation,
  listBusinessHermesConsultations: mocks.listConsultations,
  sendBusinessHermesChat: mocks.send,
  sendBusinessHermesConsultationMessage: mocks.sendConsultationMessage,
  getHermesSearchTrialScope: mocks.getTrialScope,
  sendHermesSearchTrialAnswer: mocks.sendTrialAnswer,
  updateBusinessHermesConsultation: mocks.updateConsultation
}));

vi.mock('../../features/kiosk/inventory/setup/useArmedNfcRead', () => ({ useArmedNfcRead: () => null }));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mocks.auth
}));

// Legacy behavior is exercised with the new capability explicitly disabled.
vi.mock('../../api/http', () => ({ api: {
  get: (url: string, ...args: unknown[]) => url.endsWith('/subjects') ? Promise.resolve({ data: { subjects: [] } }) : mocks.knowledgeGet(url, ...args),
  post: (url: string, ...args: unknown[]) => url.endsWith('/subjects/recent') ? Promise.resolve({ data: { subjects: [] } }) : mocks.knowledgePost(url, ...args),
} }));
vi.mock('../../features/hermes-knowledge/knowledgeReviewApi', async importOriginal => ({
  ...await importOriginal<typeof import('../../features/hermes-knowledge/knowledgeReviewApi')>(),
  listKnowledgePendingReviews: mocks.pendingReviews,
}));
// Tag scanning is covered by useKnowledgePoster; here an employee has already scanned.
vi.mock('../../features/hermes-knowledge/useKnowledgePoster', () => ({
  useKnowledgePoster: (active: boolean) => ({ poster: active ? mocks.poster : null, pending: [], partNumber: null, setPartNumber: () => undefined,
    error: null, verifying: false, consume: () => null, clear: () => undefined, removePending: () => undefined }),
}));

vi.mock('./HermesChatPanel', () => ({
  default: (props: {
    inquiryMode?: { active: boolean; unreadCount: number; onSelect: () => void };
    mode?: 'legacy' | 'consultations';
    messages: Array<{ id: string; content: string; display?: { records: Array<{ sourceLabel: string }> }; evidence?: ReadonlyArray<{ id: string; title: string }> }>;
    draft: string;
    isBusy: boolean;
    isConsultationsLoading?: boolean;
    isConsultationDetailLoading?: boolean;
    isMessageHistoryLoading?: boolean;
    error: string | null;
    consultationError?: string | null;
    consultations?: Array<{ id: string; title: string }>;
    activeConsultation?: { id: string; title: string; messages: Array<{ id: string; content: string }>; messagesNextCursor?: string | null } | null;
    knowledgeMode?: 'search' | 'knowledge' | 'record-pilot';
    recordPilotAvailable?: boolean;
    onKnowledgeModeChange?: (mode: 'search' | 'knowledge' | 'record-pilot') => void;
    conversationExtension?: ReactNode;
    conversationContent?: ReactNode;
    attachmentControl?: ReactNode;
    composerVisible?: boolean;
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
      {props.onKnowledgeModeChange ? (
        <div data-testid="hermes-mode-selector">
          <button type="button" aria-pressed={props.knowledgeMode === 'search'} onClick={() => props.onKnowledgeModeChange?.('search')}>検索</button>
          <button type="button" aria-pressed={props.knowledgeMode === 'knowledge'} onClick={() => props.onKnowledgeModeChange?.('knowledge')}>ナレッジ</button>
          {props.recordPilotAvailable ? <button type="button" aria-pressed={props.knowledgeMode === 'record-pilot'} onClick={() => props.onKnowledgeModeChange?.('record-pilot')}>JEV記録</button> : null}
          {props.inquiryMode ? <button type="button" aria-pressed={props.inquiryMode.active} onClick={props.inquiryMode.onSelect}>お問い合わせ {props.inquiryMode.unreadCount || ''}</button> : null}
        </div>
      ) : null}
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
          {message.display ? <output data-testid="record-display">{JSON.stringify(message.display)}</output> : null}
          {message.evidence?.map((evidence) => <p key={evidence.id}>{evidence.title}</p>)}
        </div>
      ))}
      {props.error ? <p role="alert">{props.error}</p> : null}
      {props.consultationError ? <p role="alert">{props.consultationError}</p> : null}
      {props.conversationContent ?? <>
      {props.conversationExtension}
      {props.attachmentControl}
      {props.composerVisible !== false ? <><input
        aria-label="Hermesへの質問"
        value={props.draft}
        onChange={(event) => props.onDraftChange(event.target.value)}
      />
      <button type="button" onClick={props.onSend} disabled={props.isBusy}>送信</button></> : null}
      </>}
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
import { HermesPageContextProvider, useHermesPageContext } from './HermesPageContext';

import type { HermesPageContext } from '../../api/domains/assembly';
import type { CSSProperties, ReactNode } from 'react';

function ContextControls({ value }: { value: HermesPageContext }) {
  const { setPageContext, clearPageContext } = useHermesPageContext();
  useEffect(() => { setPageContext(value); return clearPageContext; }, [value, setPageContext, clearPageContext]);
  return <>
    <button onClick={clearPageContext}>clear page context</button>
    <button onClick={() => setPageContext({ ...value, entity: { ...value.entity, value: 'FH002' } })}>change page context</button>
  </>;
}

function GuideRouteControls() {
  const navigate = useNavigate();
  const location = useLocation();
  return <><button onClick={() => navigate('/kiosk/assembly/procedure-documents/example/edit')}>文書を開く</button><span data-testid="guide-route">{location.pathname}</span></>;
}

function render(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return testingRender(ui, { wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider> });
}

function renderChat(path = '/kiosk/assembly', pageContext?: HermesPageContext) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <HermesPageContextProvider>
        {pageContext ? <ContextControls value={pageContext} /> : null}
        <HermesFloatingChat />
      </HermesPageContextProvider>
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
    mocks.inquirySummary.mockReset().mockResolvedValue({ isReceiver: false, unreadCount: 0 });
    mocks.inquiryList.mockReset().mockResolvedValue({ threads: [] });
    mocks.auth.user = null;
    mocks.auth.token = null;
    mocks.send.mockReset();
    mocks.getTrialScope.mockReset().mockResolvedValue({ enabled: false });
    mocks.sendTrialAnswer.mockReset();
    mocks.listConsultations.mockReset();
    mocks.listConsultations.mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
    mocks.createConsultation.mockReset();
    mocks.getConsultation.mockReset();
    mocks.sendConsultationMessage.mockReset();
    mocks.updateConsultation.mockReset();
    mocks.cancelConsultation.mockReset().mockResolvedValue(undefined);
    mocks.knowledgeGet.mockReset().mockImplementation(async (url: string) => ({ data: url.endsWith('capabilities') ? { enabled: false } : { intakes: [] } }));
    mocks.knowledgePost.mockReset();
    mocks.pendingReviews.mockReset().mockResolvedValue({ reviewer: { rank: 'leader' }, reviews: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens inquiries from the orange trigger with an unread badge', async () => {
    mocks.inquirySummary.mockResolvedValue({ isReceiver: true, unreadCount: 2 });
    renderChat();
    const trigger = await screen.findByRole('button', { name: 'お問い合わせ 未読 2 件' });
    expect(trigger).toHaveClass('hermes-floating-trigger--inquiry-unread');
    expect(trigger.querySelector('.hermes-floating-trigger__inquiry-count')).toHaveTextContent('2');
    expect(trigger).toHaveTextContent('✉');
    fireEvent.click(trigger);
    expect(await screen.findByText('社員証をタッチ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'お問い合わせ 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('textbox', { name: 'Hermesへの質問' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '検索' }));
    expect(screen.queryByText('社員証をタッチ')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Hermesへの質問' })).toBeInTheDocument();
  });

  it.each(['/admin/kiosk-settings', '/login', '/signage'])('does not request summary or offer inquiries at %s', async path => {
    renderChat(path);
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    await screen.findByTestId('hermes-panel');
    expect(mocks.inquirySummary).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /お問い合わせ/ })).not.toBeInTheDocument();
  });

  it('does not request summary or offer inquiries without a resolved client key', async () => {
    mocks.clientKey = '';
    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    await screen.findByTestId('hermes-panel');
    expect(mocks.inquirySummary).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /お問い合わせ/ })).not.toBeInTheDocument();
  });

  it.each(['手順書の作り方', '手順書はどうやって作るの?', '手順書を編集したい'])('offers local assembly guides for %s without creating or sending a consultation', async question => {
    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    const input = await screen.findByRole('textbox', { name: 'Hermesへの質問' });
    fireEvent.change(input, { target: { value: question } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    expect(screen.getByText('どの手順書ですか?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '組立の手順書を登録' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '組立の手順書を編集' })).toBeInTheDocument();
    expect(screen.queryByText('加工の作業手順書')).not.toBeInTheDocument();
    expect(mocks.createConsultation).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.sendConsultationMessage).not.toHaveBeenCalled();
  });

  it('preserves guide progress across same-tab navigation, completes and offers the other guide', async () => {
    render(<MemoryRouter initialEntries={['/kiosk/assembly']}><HermesPageContextProvider><GuideRouteControls /><HermesFloatingChat /></HermesPageContextProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Hermesへの質問' }), { target: { value: '手順書を編集したい' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    fireEvent.click(screen.getByRole('button', { name: '組立の手順書を編集' }));
    expect(screen.queryByTestId('hermes-panel')).not.toBeInTheDocument();
    expect(screen.getByText('手順 1 / 9')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ライブラリへ移動/ }));
    expect(screen.getByTestId('guide-route')).toHaveTextContent('/kiosk/assembly/library');
    fireEvent.click(screen.getByRole('button', { name: '文書を開く' }));
    expect(screen.getByText('手順 1 / 9')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    expect(screen.getByRole('heading', { name: '暗証番号を入力' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ライブラリへ移動/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(screen.getByText('手順 1 / 9')).toBeInTheDocument();
    for (let index = 0; index < 9; index++) fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    expect(screen.getByText('案内が完了しました')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '組立の手順書を登録' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '組立の手順書を編集' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '組立の手順書を登録' }));
    expect(screen.getByRole('heading', { name: 'ファイルから登録' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '終了' }));
    expect(screen.queryByRole('region', { name: '操作ガイド' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('hermes-panel')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /業務Hermesチャットを開く/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('returns to questions and sends an unrelated question without guide history', async () => {
    mocks.send.mockResolvedValue({ status: 'ready', message: '検索結果', evidence: [] });
    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    await waitFor(() => expect(screen.queryByTestId('consultation-list')).not.toBeInTheDocument());
    fireEvent.change(screen.getByRole('textbox', { name: 'Hermesへの質問' }), { target: { value: '手順書の作り方' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    fireEvent.click(screen.getByRole('button', { name: '組立の手順書を編集' }));
    fireEvent.click(screen.getByRole('button', { name: '質問に戻る' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Hermesへの質問' }), { target: { value: '品番ABCの不適合は?' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
    expect(mocks.send.mock.calls[0][0].messages).toEqual([{ role: 'user', content: '品番ABCの不適合は?' }]);
    expect(mocks.createConsultation).not.toHaveBeenCalled();
  });

  it('pauses board decoration throughout a held pointer and resumes after inactivity', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
    renderChat('/kiosk/production-schedule/planning-board/');
    const trigger = screen.getByRole('button', { name: /業務Hermesチャットを開く/ });
    expect(trigger).not.toHaveAttribute('data-interacting');
    fireEvent.pointerDown(window, { pointerId: 1 });
    act(() => vi.advanceTimersByTime(2000));
    expect(trigger).toHaveAttribute('data-interacting', 'true');
    fireEvent.pointerUp(window, { pointerId: 1 });
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.scroll(document);
    act(() => vi.advanceTimersByTime(1199));
    expect(trigger).toHaveAttribute('data-interacting', 'true');
    act(() => vi.advanceTimersByTime(1));
    expect(trigger).not.toHaveAttribute('data-interacting');
  });

  it('resumes after pointer cancellation and keyboard activity, and removes listeners on unmount', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
    const { unmount } = renderChat('/kiosk/production-schedule/planning-board');
    const trigger = screen.getByRole('button', { name: /業務Hermesチャットを開く/ });
    fireEvent.pointerDown(window, { pointerId: 1 });
    fireEvent.pointerCancel(window, { pointerId: 1 });
    act(() => vi.advanceTimersByTime(1200));
    expect(trigger).not.toHaveAttribute('data-interacting');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(trigger).toHaveAttribute('data-interacting', 'true');
    unmount();
    expect(trigger).not.toHaveAttribute('data-interacting');
    fireEvent.wheel(window);
    expect(trigger).not.toHaveAttribute('data-interacting');
  });

  it('keeps decoration running during interaction outside the board', () => {
    renderChat();
    const trigger = screen.getByRole('button', { name: /業務Hermesチャットを開く/ });
    fireEvent.pointerDown(window);
    fireEvent.wheel(window);
    expect(trigger).not.toHaveAttribute('data-interacting');
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

  it('mounts approval chips beside the poster and expands the opened review', async () => {
    mocks.knowledgeGet.mockResolvedValue({ data: { enabled: true, intakes: [] } });
    mocks.pendingReviews.mockResolvedValue({ reviewer: { rank: 'leader' }, reviews: [{
      procedureId: 'p1', revisionId: 'r1', title: '部品Aの段取り', stepCount: 1, createdAt: '2026-10-04',
      publishedRevisionNumber: null, reportComment: null,
    }] });
    mocks.knowledgePost.mockResolvedValue({ data: { procedure: {
      formatVersion: 1, procedureId: 'p1', revisionId: 'r1', revisionNumber: 1, title: '部品Aの段取り', category: '段取り',
      identifiers: {}, reviewTier: 'approval_required', state: 'pending_approval', createdAt: '2026-10-04', steps: [],
    } } });
    renderChat();
    fireEvent.click(screen.getByRole('button', { name: '業務Hermesチャットを開く。ドラッグで移動できます' }));
    fireEvent.click(screen.getByRole('button', { name: 'ナレッジ' }));
    expect(await screen.findByText('👤 田中')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '✅ 承認待ち 1' }));
    fireEvent.click(await screen.findByRole('button', { name: /部品Aの段取り/ }));
    expect(await screen.findByRole('button', { name: '承認して公開' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '標準' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '送信' })).not.toBeInTheDocument();
    expect(mocks.knowledgePost).toHaveBeenCalledWith('/hermes-knowledge/reviews/r1/detail', { reviewerTagUid: 'tag-1' });
  });

  it('routes the default search request through Chat without knowledge intake', async () => {
    mocks.knowledgeGet.mockImplementation(async (url: string) => ({ data: url.endsWith('capabilities') ? { enabled: true } : { intakes: [] } }));
    mocks.send.mockResolvedValue({
      status: 'ready',
      message: '検索結果です',
      evidence: [],
      partNumber: null,
      shootingTarget: null,
      needsClarification: false,
      clarificationMessage: null
    });

    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    expect(screen.getByRole('button', { name: '検索' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(await screen.findByRole('textbox', { name: 'Hermesへの質問' }), { target: { value: '三島工場機械課の最近の不適合情報を２件出して' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));

    await waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
    expect(mocks.send.mock.calls[0][0].messages.at(-1)).toEqual({
      role: 'user',
      content: '三島工場機械課の最近の不適合情報を２件出して'
    });
    expect(mocks.knowledgeGet).not.toHaveBeenCalled();
    expect(mocks.knowledgePost).not.toHaveBeenCalled();
  });

  it('exposes the JEV record mode only when the trial scope is enabled', async () => {
    mocks.getTrialScope.mockResolvedValue({ enabled: true, snapshotCount: 6, organizedCount: 6 });
    mocks.sendTrialAnswer.mockResolvedValue({
      status: 'completed',
      answer: '工程：旋盤加工。現象：外径が規格上限を0.12 mm超過。処置：再加工を実施。原因は記載なし。',
      recordIds: ['fixture-nc-001'],
      elapsedMs: 12
    });

    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    const pilotButton = await screen.findByRole('button', { name: 'JEV記録' });
    fireEvent.click(pilotButton);
    const input = screen.getByRole('textbox', { name: 'Hermesへの質問' });
    fireEvent.change(input, { target: { value: '旋盤加工で外径が大きい記録を探して' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));

    await waitFor(() => expect(mocks.sendTrialAnswer).toHaveBeenCalledOnce());
    expect(mocks.sendTrialAnswer.mock.calls[0][0]).toMatchObject({ question: '旋盤加工で外径が大きい記録を探して' });
    expect(mocks.sendTrialAnswer.mock.calls[0][0].sessionId).toEqual(expect.any(String));
    expect(mocks.sendTrialAnswer.mock.calls[0][0]).not.toHaveProperty('pageContext');
    expect(await screen.findByText('工程：旋盤加工。現象：外径が規格上限を0.12 mm超過。処置：再加工を実施。原因は記載なし。')).toBeInTheDocument();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.sendConsultationMessage).not.toHaveBeenCalled();
  });

  it('keeps the record display in the assistant message sent to the panel', async () => {
    const display = { records: [{ sourceLabel: '不適合情報', fields: [{ label: '本文', value: '原文。', role: 'body' }] }],
      notices: ['件数案内'], dataAsOf: '2026-10-08 06:30' };
    mocks.getTrialScope.mockResolvedValue({ enabled: true });
    mocks.sendTrialAnswer.mockResolvedValue({ status: 'completed', answer: '元の回答', recordIds: ['1'], elapsedMs: 1, display });
    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'JEV記録' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Hermesへの質問' }), { target: { value: '記録を探して' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    expect(JSON.parse((await screen.findByTestId('record-display')).textContent!)).toEqual(display);
    expect(screen.getByText('元の回答')).toBeInTheDocument();
  });

  it.each([
    { enabled: true, kind: 'partNumber' as const, visible: true },
    { enabled: false, kind: 'partNumber' as const, visible: false },
    ...(['drawingNumber', 'nonconformityNo', 'procedureId'] as const).map(kind => ({ enabled: true, kind, visible: false })),
    { enabled: true, kind: undefined, visible: false },
  ])('gates part shortcuts by context and scope: $kind / $enabled', async ({ enabled, kind, visible }) => {
    mocks.getTrialScope.mockResolvedValue({ enabled });
    const pageContext = kind ? { path: '/kiosk/part-measurement/edit/sheet-1', entity: { kind, value: 'FH001' } } : undefined;
    renderChat(pageContext?.path, pageContext);
    const launcher = screen.getByRole('button', { name: /業務Hermesチャットを開く/ });
    expect(launcher.querySelector('.hermes-floating-trigger__context-dot') !== null).toBe(kind === 'partNumber');
    expect(screen.queryByRole('group', { name: '品番ショートカット' })).not.toBeInTheDocument();
    expect(mocks.getTrialScope).not.toHaveBeenCalled();
    expect(mocks.sendTrialAnswer).not.toHaveBeenCalled();
    fireEvent.click(launcher);
    await waitFor(() => expect(mocks.getTrialScope).toHaveBeenCalledOnce());
    await screen.findByTestId('hermes-panel');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'JEV記録' }) !== null).toBe(enabled));
    expect(screen.queryByRole('group', { name: '品番ショートカット' }) !== null).toBe(visible);
    expect(launcher.querySelector('.hermes-floating-trigger__context-dot') !== null).toBe(kind === 'partNumber' && enabled);
    expect(mocks.sendTrialAnswer).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.createConsultation).not.toHaveBeenCalled();
    expect(mocks.knowledgeGet).not.toHaveBeenCalled();
    expect(mocks.listConsultations).toHaveBeenCalledOnce();
    if (visible) {
      expect(screen.getByText('FH001')).toBeInTheDocument();
      expect(launcher).toHaveAttribute('title', 'この品番で検索できます');
      fireEvent.click(screen.getByRole('button', { name: 'ナレッジ' }));
      expect(screen.queryByRole('group', { name: '品番ショートカット' })).not.toBeInTheDocument();
    }
  });

  it.each(['不適合', '手順書'])('sends %s once via record-pilot immediately after switching and disables shortcuts while busy', async label => {
    mocks.getTrialScope.mockResolvedValue({ enabled: true });
    mocks.send.mockResolvedValue({ status: 'ready', message: '以前の回答', evidence: [] });
    let resolveAnswer!: (value: { status: string; answer: string; recordIds: string[]; elapsedMs: number }) => void;
    mocks.sendTrialAnswer.mockImplementation(() => new Promise(resolve => { resolveAnswer = resolve; }));
    const pageContext = { path: '/kiosk/part-measurement/edit/sheet-1', entity: { kind: 'partNumber' as const, value: 'FH001' } };
    renderChat(pageContext.path, pageContext);
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    const shortcut = await screen.findByRole('button', { name: label });
    expect(mocks.sendTrialAnswer).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Hermesへの質問' }), { target: { value: '以前の質問' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    await screen.findByText('以前の回答');
    fireEvent.click(shortcut);
    expect(mocks.sendTrialAnswer).toHaveBeenCalledOnce();
    expect(mocks.sendTrialAnswer.mock.calls[0][0]).toMatchObject({ question: `この品番の${label}`, pageContext });
    expect(screen.getByRole('button', { name: 'JEV記録' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(`この品番の${label}`)).toBeInTheDocument();
    expect(screen.queryByText('以前の質問')).not.toBeInTheDocument();
    expect(screen.queryByText('以前の回答')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '不適合' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '手順書' })).toBeDisabled();
    fireEvent.click(shortcut);
    expect(mocks.sendTrialAnswer).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.createConsultation).not.toHaveBeenCalled();
    expect(mocks.sendConsultationMessage).not.toHaveBeenCalled();
    expect(mocks.knowledgeGet).not.toHaveBeenCalled();
    expect(mocks.getTrialScope).toHaveBeenCalledOnce();
    await act(async () => resolveAnswer({ status: 'completed', answer: '回答', recordIds: [], elapsedMs: 1 }));
    expect(screen.getByRole('button', { name: '不適合' })).not.toBeDisabled();
    fireEvent.click(screen.getByText('clear page context'));
    expect(screen.queryByRole('group', { name: '品番ショートカット' })).not.toBeInTheDocument();
    expect(mocks.sendTrialAnswer).toHaveBeenCalledOnce();
    expect(mocks.getTrialScope).toHaveBeenCalledOnce();
    expect(mocks.listConsultations).toHaveBeenCalledOnce();
  });

  it('keeps the conversation when a shortcut is pressed in record-pilot mode', async () => {
    mocks.getTrialScope.mockResolvedValue({ enabled: true });
    mocks.sendTrialAnswer.mockResolvedValue({ status: 'completed', answer: '最初の回答', recordIds: [], elapsedMs: 1 });
    const pageContext = { path: '/page', entity: { kind: 'partNumber' as const, value: 'FH001' } };
    renderChat(pageContext.path, pageContext);
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    fireEvent.click(await screen.findByRole('button', { name: '不適合' }));
    await screen.findByText('最初の回答');
    fireEvent.click(screen.getByRole('button', { name: '手順書' }));
    await waitFor(() => expect(mocks.sendTrialAnswer).toHaveBeenCalledTimes(2));
    expect(screen.getByText('この品番の不適合')).toBeInTheDocument();
    expect(screen.getByText('この品番の手順書')).toBeInTheDocument();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('sends a shortcut while the ordinary consultation list is still loading', async () => {
    mocks.listConsultations.mockImplementation(() => new Promise(() => undefined));
    mocks.getTrialScope.mockResolvedValue({ enabled: true });
    mocks.sendTrialAnswer.mockResolvedValue({ status: 'completed', answer: '回答', recordIds: [], elapsedMs: 1 });
    const pageContext = { path: '/page', entity: { kind: 'partNumber' as const, value: 'FH001' } };
    renderChat(pageContext.path, pageContext);
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    fireEvent.click(await screen.findByRole('button', { name: '手順書' }));
    await screen.findByText('回答');
    expect(mocks.sendTrialAnswer).toHaveBeenCalledOnce();
    expect(mocks.sendTrialAnswer.mock.calls[0][0]).toMatchObject({ question: 'この品番の手順書', pageContext });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.createConsultation).not.toHaveBeenCalled();
    expect(screen.queryByText('相談を準備しています。少し待ってから送信してください。')).not.toBeInTheDocument();
  });

  it('does not fetch on part changes or reopening and sends the current part only on a tap', async () => {
    mocks.getTrialScope.mockResolvedValue({ enabled: true });
    mocks.sendTrialAnswer.mockResolvedValue({ status: 'completed', answer: '回答', recordIds: [], elapsedMs: 1 });
    const pageContext = { path: '/page', entity: { kind: 'partNumber' as const, value: 'FH001' } };
    renderChat(pageContext.path, pageContext);
    fireEvent.click(screen.getByText('change page context'));
    expect(mocks.getTrialScope).not.toHaveBeenCalled();
    expect(mocks.listConsultations).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    await screen.findByRole('group', { name: '品番ショートカット' });
    fireEvent.click(screen.getByText('clear page context'));
    fireEvent.click(screen.getByText('change page context'));
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    await screen.findByRole('group', { name: '品番ショートカット' });
    expect(mocks.getTrialScope).toHaveBeenCalledOnce();
    expect(mocks.listConsultations).toHaveBeenCalledOnce();
    expect(mocks.sendTrialAnswer).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.knowledgeGet).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '不適合' }));
    await screen.findByText('回答');
    expect(mocks.sendTrialAnswer).toHaveBeenCalledOnce();
    expect(mocks.sendTrialAnswer.mock.calls[0][0]).toMatchObject({ question: 'この品番の不適合', pageContext: {
      ...pageContext, entity: { kind: 'partNumber', value: 'FH002' },
    } });
  });

  it('sends the latest page context only in JEV record mode and omits it after clearing', async () => {
    mocks.getTrialScope.mockResolvedValue({ enabled: true });
    mocks.sendTrialAnswer.mockResolvedValue({ status: 'completed', answer: 'trial answer', recordIds: [], elapsedMs: 1 });
    const pageContext = { path: '/kiosk/part-measurement/self-inspection', entity: { kind: 'partNumber' as const, value: 'FH001' } };
    renderChat(pageContext.path, pageContext);
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    const pilotButton = await screen.findByRole('button', { name: 'JEV記録' });
    const input = screen.getByRole('textbox', { name: 'Hermesへの質問' });
    fireEvent.change(input, { target: { value: '通常検索' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
    expect(mocks.send.mock.calls[0][0]).not.toHaveProperty('pageContext');
    await waitFor(() => expect(screen.getByRole('button', { name: '送信' })).not.toBeDisabled());
    fireEvent.click(pilotButton);
    fireEvent.change(input, { target: { value: 'この品番の不適合' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    await waitFor(() => expect(mocks.sendTrialAnswer).toHaveBeenCalledOnce());
    expect(mocks.sendTrialAnswer.mock.calls[0][0]).toMatchObject({ question: 'この品番の不適合', pageContext });
    await waitFor(() => expect(screen.getByRole('button', { name: '送信' })).not.toBeDisabled());
    fireEvent.click(screen.getByText('clear page context'));
    fireEvent.change(input, { target: { value: '最近の不適合' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    await waitFor(() => expect(mocks.sendTrialAnswer).toHaveBeenCalledTimes(2));
    expect(mocks.sendTrialAnswer.mock.calls[1][0]).not.toHaveProperty('pageContext');
  });

  it('keeps the record-pilot confirmation round trip on one session', async () => {
    mocks.getTrialScope.mockResolvedValue({ enabled: true, snapshotCount: 6, organizedCount: 6 });
    mocks.sendTrialAnswer
      .mockResolvedValueOnce({
        status: 'clarification',
        answer: '処置条件を指定しますか？',
        recordIds: [],
        elapsedMs: 8,
        confirmationPending: {
          request: 'clarify',
          question: '処置条件を指定しますか？',
          purpose: '検索条件の確認',
          requiredItems: [],
          confirmedInfo: {},
          unresolvedItems: ['treatment']
        }
      })
      .mockResolvedValueOnce({
        status: 'completed',
        answer: '工程：フライス加工。現象：側面に打痕を確認。処置：選別して隔離。',
        recordIds: ['fixture-nc-002'],
        elapsedMs: 11
      });

    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'JEV記録' }));
    const input = screen.getByRole('textbox', { name: 'Hermesへの質問' });
    fireEvent.change(input, { target: { value: 'フライス加工の打痕記録を探して' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    await waitFor(() => expect(mocks.sendTrialAnswer).toHaveBeenCalledOnce());
    expect(await screen.findByText('処置条件を指定しますか？')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '処置は指定しません' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    await waitFor(() => expect(mocks.sendTrialAnswer).toHaveBeenCalledTimes(2));
    expect(mocks.sendTrialAnswer.mock.calls[1][0].sessionId).toBe(mocks.sendTrialAnswer.mock.calls[0][0].sessionId);
    expect(await screen.findByText('工程：フライス加工。現象：側面に打痕を確認。処置：選別して隔離。')).toBeInTheDocument();
  });

  it('switches explicitly to knowledge, preserves draft and attachments, and routes intake only there', async () => {
    mocks.knowledgeGet.mockImplementation(async (url: string) => ({ data: url.endsWith('capabilities') ? { enabled: true } : { intakes: [] } }));
    mocks.knowledgePost.mockResolvedValue({ data: {
      id: 'knowledge-intake-1', text: '設備点検の記録', state: 'ready', version: 2, message: 'ナレッジの記録に整理して保存しました。',
      files: [{ filename: '点検.jpg', kind: 'image' }], choices: [], errorCode: null
    } });
    mocks.send.mockResolvedValue({
      status: 'ready', message: '検索結果です', evidence: [], partNumber: null, shootingTarget: null,
      needsClarification: false, clarificationMessage: null
    });

    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    fireEvent.click(screen.getByRole('button', { name: 'ナレッジ' }));
    fireEvent.click(await screen.findByRole('button', { name: 'おまかせ' }));
    const input = await screen.findByRole('textbox', { name: 'Hermesへの質問' });
    const attachment = await screen.findByLabelText('写真・PDFを添付');
    const file = new File(['image'], '点検.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { value: '設備点検の記録' } });
    fireEvent.change(attachment, { target: { files: [file] } });

    fireEvent.click(screen.getByRole('button', { name: '検索' }));
    expect(input).toHaveValue('設備点検の記録');
    expect(screen.queryByLabelText('写真・PDFを添付')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: '新規' })).not.toBeInTheDocument());
    fireEvent.change(input, { target: { value: '三島工場機械課の最近の不適合情報を２件出して' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
    expect(mocks.send.mock.calls[0][0].messages.at(-1)).toEqual({
      role: 'user', content: '三島工場機械課の最近の不適合情報を２件出して'
    });
    expect(mocks.knowledgePost).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'ナレッジ' }));
    fireEvent.click(await screen.findByRole('button', { name: 'おまかせ' }));
    expect(await screen.findByLabelText('写真・PDFを添付')).toBeInTheDocument();
    expect(screen.getByText('点検.jpg')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '添付を送信' }));
    await waitFor(() => expect(mocks.knowledgePost).toHaveBeenCalledOnce());
    expect(mocks.knowledgePost.mock.calls[0][1]).toMatchObject({
      files: [{ filename: '点検.jpg', kind: 'image', base64: 'aW1hZ2U=' }]
    });
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it('keeps a newer Search draft after a Knowledge request resolves', async () => {
    const knowledgeResult = {
      id: 'knowledge-intake-pending', text: 'ナレッジ登録を待つ入力', state: 'ready', version: 2,
      message: 'ナレッジの記録に整理して保存しました。', files: [], choices: [], errorCode: null
    };
    let knowledgeResolved = false;
    mocks.knowledgeGet.mockImplementation(async (url: string) => ({ data: url.endsWith('capabilities') ? { enabled: true } : { intakes: knowledgeResolved ? [knowledgeResult] : [] } }));
    let resolveKnowledge!: (value: unknown) => void;
    const knowledgeResponse = new Promise(resolve => { resolveKnowledge = resolve; });
    mocks.knowledgePost.mockReturnValueOnce(knowledgeResponse);

    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    fireEvent.click(screen.getByRole('button', { name: 'ナレッジ' }));
    fireEvent.click(await screen.findByRole('button', { name: 'おまかせ' }));
    const input = await screen.findByRole('textbox', { name: 'Hermesへの質問' });
    fireEvent.change(input, { target: { value: 'ナレッジ登録を待つ入力' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    await waitFor(() => expect(mocks.knowledgePost).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('button', { name: '検索' }));
    fireEvent.change(input, { target: { value: '検索中に作った新しい質問' } });
    expect(input).toHaveValue('検索中に作った新しい質問');

    await act(async () => {
      knowledgeResolved = true;
      resolveKnowledge({ data: knowledgeResult });
      await knowledgeResponse;
    });
    fireEvent.click(screen.getByRole('button', { name: 'ナレッジ' }));
    await screen.findByText('ナレッジの記録に整理して保存しました。');
    expect(input).toHaveValue('検索中に作った新しい質問');
  });

  it('submits Search while a Knowledge request remains pending', async () => {
    mocks.knowledgeGet.mockImplementation(async (url: string) => ({ data: url.endsWith('capabilities') ? { enabled: true } : { intakes: [] } }));
    let resolveKnowledge!: (value: unknown) => void;
    let knowledgeSettled = false;
    const knowledgeResponse = new Promise(resolve => { resolveKnowledge = value => { knowledgeSettled = true; resolve(value); }; });
    mocks.knowledgePost.mockReturnValueOnce(knowledgeResponse);
    mocks.send.mockResolvedValue({
      status: 'ready', message: '検索結果です', evidence: [], partNumber: null, shootingTarget: null,
      needsClarification: false, clarificationMessage: null
    });

    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    fireEvent.click(screen.getByRole('button', { name: 'ナレッジ' }));
    fireEvent.click(await screen.findByRole('button', { name: 'おまかせ' }));
    const input = await screen.findByRole('textbox', { name: 'Hermesへの質問' });
    fireEvent.change(input, { target: { value: '処理中のナレッジ入力' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    await waitFor(() => expect(mocks.knowledgePost).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('button', { name: '検索' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '新規' })).not.toBeInTheDocument());
    fireEvent.change(input, { target: { value: '保留中でも送る検索質問' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
    expect(knowledgeSettled).toBe(false);
    expect(mocks.knowledgePost).toHaveBeenCalledOnce();

    await act(async () => {
      resolveKnowledge({ data: {
        id: 'knowledge-intake-pending-search', text: '処理中のナレッジ入力', state: 'ready', version: 2,
        message: 'ナレッジの記録に整理して保存しました。', files: [], choices: [], errorCode: null
      } });
      await knowledgeResponse;
    });
  });

  it('does not fall back to Chat when knowledge inference delegates an intake', async () => {
    mocks.knowledgeGet.mockImplementation(async (url: string) => ({ data: url.endsWith('capabilities') ? { enabled: true } : { intakes: [] } }));
    mocks.knowledgePost.mockResolvedValue({ data: {
      id: 'knowledge-intake-delegated', text: '別業務の確認', state: 'delegated', version: 2, message: '通常の業務相談に引き継ぎます。',
      files: [], choices: [], errorCode: null
    } });

    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    fireEvent.click(screen.getByRole('button', { name: 'ナレッジ' }));
    fireEvent.click(await screen.findByRole('button', { name: 'おまかせ' }));
    const input = await screen.findByRole('textbox', { name: 'Hermesへの質問' });
    fireEvent.change(input, { target: { value: '別業務の確認' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));

    await waitFor(() => expect(mocks.knowledgePost).toHaveBeenCalledOnce());
    expect(mocks.send).not.toHaveBeenCalled();
    expect(input).toHaveValue('');
    expect(await screen.findByText('通常の業務相談に引き継ぎます。')).toBeInTheDocument();
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

  it('cancels background work when an idle consultation is closed', async () => {
    const item = consultation('case-prefetch-close', '先読み中の相談');
    mocks.listConsultations.mockResolvedValue({ consultations: [], enabled: true });
    mocks.createConsultation.mockResolvedValue({ ...item, messages: [] });
    renderChat();
    fireEvent.click(screen.getByRole('button', { name: /業務Hermesチャットを開く/ }));
    fireEvent.click(await screen.findByRole('button', { name: '新規' }));
    await screen.findByText('先読み中の相談');
    expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    await waitFor(() => expect(mocks.cancelConsultation).toHaveBeenCalledWith(item.id));
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
        <HermesPageContextProvider><HermesFloatingChat /></HermesPageContextProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.queryByText('相談内容を読み込んでいます…')).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: '新規' })).toBeInTheDocument();
    resolveDetail?.(detail(item.id, [{ id: 'late-detail', role: 'assistant', content: '旧identityの詳細' }]));
    await waitFor(() => expect(screen.queryByText('旧identityの詳細')).not.toBeInTheDocument());
  });
});
