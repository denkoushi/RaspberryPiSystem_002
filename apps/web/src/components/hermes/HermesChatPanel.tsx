import { ChatContainer, MainContainer, Message, MessageInput, MessageList } from '@chatscope/chat-ui-kit-react';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { ProtectedImage } from '../ProtectedImage';

import type {
  BusinessHermesChatEvidence,
  BusinessHermesConsultationDetail,
  BusinessHermesConsultationItem
} from '../../api/domains/assembly';

export type HermesPanelMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  evidence?: readonly BusinessHermesChatEvidence[];
  evidenceVisible?: boolean;
  createdAt?: string;
};

export type HermesConsultationSuggestion = {
  options?: string[];
  title?: string;
  relatedIdentifiers: string[];
  prompt: string;
};

export type HermesChatPanelProps = {
  mode?: 'legacy' | 'consultations';
  messages: readonly HermesPanelMessage[];
  draft: string;
  isBusy: boolean;
  error: string | null;
  authRequired: string | null;
  consultations?: readonly BusinessHermesConsultationItem[];
  activeConsultation?: BusinessHermesConsultationDetail | null;
  isConsultationsLoading?: boolean;
  isConsultationDetailLoading?: boolean;
  isMessageHistoryLoading?: boolean;
  messageHistoryError?: string | null;
  consultationError?: string | null;
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
  suggestion?: HermesConsultationSuggestion | null;
  onAnswerSuggestion?: (answer: string) => void;
  style?: CSSProperties;
};

function escapeInputHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character] ?? character);
}

function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  ));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(mediaQuery.matches);
    update();
    mediaQuery.addEventListener?.('change', update);
    return () => mediaQuery.removeEventListener?.('change', update);
  }, []);

  return reducedMotion;
}

function formatConsultationUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function consultationLabel(consultation: BusinessHermesConsultationItem): string {
  return consultation.title.trim() || '新しい相談';
}

function LazyProtectedImage({ imageUrl, alt }: { imageUrl: string; alt: string }) {
  const [isVisible, setIsVisible] = useState(false);
  const placeholderRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const node = placeholderRef.current;
    if (!node || isVisible) return;
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '160px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [isVisible]);

  if (!isVisible) {
    return (
      <span ref={placeholderRef} className="hermes-chat-panel__image-placeholder" role="status">
        写真を準備中…
      </span>
    );
  }

  return <ProtectedImage imagePath={imageUrl} alt={alt} className="hermes-chat-panel__evidence-image" />;
}

function EvidenceCard({ evidence }: { evidence: BusinessHermesChatEvidence }) {
  const meta = [
    evidence.partNumber ? `品番 ${evidence.partNumber}` : null,
    evidence.shootingTarget ? `対象 ${evidence.shootingTarget}` : null,
    evidence.step ? `手順 ${evidence.step}` : null,
    evidence.publishedRevisionCreatedAt ? `公開改訂の作成 ${evidence.publishedRevisionCreatedAt}` : null,
    evidence.sourceVersionDate ? `元データ日時 ${evidence.sourceVersionDate}` : null
  ].filter(Boolean).join('・');
  const imageLabel = evidence.rawImageLabel?.trim() || `${evidence.title}の写真`;

  return (
    <article className="hermes-chat-panel__evidence">
      <div>
        <p className="hermes-chat-panel__evidence-title">{evidence.title}</p>
        {meta ? <p className="hermes-chat-panel__evidence-meta">{meta}</p> : null}
        {evidence.text ? <p className="hermes-chat-panel__evidence-text">{evidence.text}</p> : null}
        {evidence.sourceUrl ? (
          <a className="hermes-chat-panel__evidence-source" href={evidence.sourceUrl} target="_blank" rel="noreferrer">
            出典を開く
          </a>
        ) : null}
      </div>
      {evidence.imageUrl ? (
        <div className="hermes-chat-panel__evidence-image-wrap">
          <LazyProtectedImage imageUrl={evidence.imageUrl} alt={imageLabel} />
          {evidence.rawImageLabel ? <span className="hermes-chat-panel__evidence-image-caption">{evidence.rawImageLabel}</span> : null}
        </div>
      ) : null}
    </article>
  );
}

export default function HermesChatPanel({
  mode = 'legacy',
  messages,
  draft,
  isBusy,
  error,
  authRequired,
  consultations = [],
  activeConsultation = null,
  isConsultationsLoading = false,
  isConsultationDetailLoading = false,
  isMessageHistoryLoading = false,
  messageHistoryError = null,
  consultationError = null,
  onDraftChange,
  onSend,
  onReset,
  onClose,
  onStop,
  isExpanded = false,
  onToggleSize,
  onNewConsultation,
  onSelectConsultation,
  onLoadOlderMessages,
  suggestion = null,
  onAnswerSuggestion,
  style
}: HermesChatPanelProps) {
  const reducedMotion = useReducedMotion();
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const editor = panelRef.current?.querySelector<HTMLElement>('[contenteditable="true"]');
    editor?.setAttribute('aria-label', 'Hermesへの質問');
  });

  const messageInput = (
    <MessageInput
      value={escapeInputHtml(draft)}
      disabled={isBusy || isConsultationDetailLoading || isMessageHistoryLoading || (mode === 'consultations' && isConsultationsLoading)}
      sendButton
      attachButton={false}
      placeholder={isBusy ? '回答を取得中…' : isConsultationsLoading ? '相談一覧を準備中…' : '自然な言葉で相談…'}
      aria-label="Hermesへの質問"
      onChange={(_innerHtml, textContent) => onDraftChange(textContent)}
      onSend={() => onSend()}
    />
  );

  return (
    <section ref={panelRef} className="hermes-chat-panel" style={style} aria-label="Hermesチャット" role="region">
      <header className="hermes-chat-panel__header">
        <div>
          {mode === 'consultations' && activeConsultation ? (
            <>
              <h2 id="hermes-chat-title" className="hermes-chat-panel__title">{consultationLabel(activeConsultation)}</h2>
              <p className="hermes-chat-panel__hint">相談を続ける</p>
            </>
          ) : null}
        </div>
        <div className="hermes-chat-panel__actions">
          {mode === 'consultations' && onNewConsultation ? (
            <button type="button" className="hermes-chat-panel__action" onClick={onNewConsultation} aria-label="新しい相談を始める">
              新規
            </button>
          ) : null}
          {mode === 'consultations' && activeConsultation ? (
            <button type="button" className="hermes-chat-panel__action" onClick={onReset} aria-label="相談一覧に戻る">
              一覧
            </button>
          ) : (
            <button type="button" className="hermes-chat-panel__action" onClick={onReset} aria-label="会話をリセット">
              リセット
            </button>
          )}
          {isBusy && onStop ? (
            <button type="button" className="hermes-chat-panel__action hermes-chat-panel__action--stop" onClick={onStop} aria-label="回答を停止">
              停止
            </button>
          ) : null}
          {onToggleSize ? (
            <button
              type="button"
              className="hermes-chat-panel__action"
              onClick={onToggleSize}
              aria-label={isExpanded ? 'チャットを標準サイズに戻す' : 'チャットを拡大'}
            >
              {isExpanded ? '標準' : '拡大'}
            </button>
          ) : null}
          <button type="button" className="hermes-chat-panel__action" onClick={onClose} aria-label="チャットを閉じる">
            閉じる
          </button>
        </div>
      </header>

      {authRequired ? <p className="hermes-chat-panel__status" role="status">{authRequired}</p> : null}
      {error ? <p className="hermes-chat-panel__status hermes-chat-panel__status--error" role="alert">{error}</p> : null}
      {consultationError ? <p className="hermes-chat-panel__status hermes-chat-panel__status--error" role="alert">{consultationError}</p> : null}
      {isBusy ? <p className="hermes-chat-panel__status" role="status">回答を考えています…{onStop ? ' 停止できます。' : ''}</p> : null}

      {mode === 'consultations' && !activeConsultation ? (
        <>
          <div className="hermes-chat-panel__consultation-list" aria-label="相談一覧">
            {isConsultationDetailLoading ? <p className="hermes-chat-panel__list-status" role="status">相談内容を読み込んでいます…</p> : null}
            {isConsultationsLoading ? <p className="hermes-chat-panel__list-status" role="status">相談一覧を読み込んでいます…</p> : null}
            {!isConsultationsLoading && consultations.length === 0 ? (
              <p className="hermes-chat-panel__list-status">まだ相談はありません。</p>
            ) : null}
            {consultations.slice(0, 10).map((consultation) => (
              <button
                key={consultation.id}
                type="button"
                className="hermes-chat-panel__consultation-item"
                onClick={() => onSelectConsultation?.(consultation.id)}
              >
                <span className="hermes-chat-panel__consultation-item-title">{consultationLabel(consultation)}</span>
                {consultation.relatedIdentifiers.length > 0 ? (
                  <span className="hermes-chat-panel__consultation-item-meta">{consultation.relatedIdentifiers.join('・')}</span>
                ) : null}
                {formatConsultationUpdatedAt(consultation.updatedAt) ? (
                  <span className="hermes-chat-panel__consultation-item-date">更新 {formatConsultationUpdatedAt(consultation.updatedAt)}</span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="hermes-chat-panel__consultation-composer">{messageInput}</div>
        </>
      ) : (
        <>
          <MainContainer className="hermes-chat-panel__main">
            <ChatContainer>
              <MessageList scrollBehavior={reducedMotion ? 'auto' : 'smooth'} autoScrollToBottom>
                <MessageList.Content>
                  {isConsultationDetailLoading ? (
                    <p className="hermes-chat-panel__list-status" role="status">相談内容を読み込んでいます…</p>
                  ) : null}
                  {mode === 'consultations' && activeConsultation?.messagesNextCursor && onLoadOlderMessages ? (
                    <div className="hermes-chat-panel__history-loader">
                      <button
                        type="button"
                        className="hermes-chat-panel__history-button"
                        onClick={onLoadOlderMessages}
                        disabled={isMessageHistoryLoading || isBusy}
                      >
                        {isMessageHistoryLoading ? '以前の履歴を読み込んでいます…' : '以前の履歴を読み込む'}
                      </button>
                      {messageHistoryError ? <p className="hermes-chat-panel__history-error" role="alert">{messageHistoryError}</p> : null}
                    </div>
                  ) : null}
                  {messages.map((message) => (
                    <Message
                      key={message.id}
                      model={{
                        message: message.content,
                        sender: message.role === 'assistant' ? 'Hermes' : 'あなた',
                        direction: message.role === 'assistant' ? 'incoming' : 'outgoing',
                        position: 'single',
                        type: 'custom'
                      }}
                    >
                      <Message.CustomContent>
                        <p className="hermes-chat-panel__message">{message.content}</p>
                        {message.evidenceVisible !== false ? message.evidence?.map((evidence) => (
                          <EvidenceCard key={`${message.id}-${evidence.kind}-${evidence.id}`} evidence={evidence} />
                        )) : null}
                      </Message.CustomContent>
                    </Message>
                  ))}
                  {suggestion ? (
                    <div className="hermes-chat-panel__suggestion" role="group" aria-label="Hermesからの候補確認">
                      <p className="hermes-chat-panel__suggestion-prompt">{suggestion.prompt}</p>
                      <div className="hermes-chat-panel__suggestion-actions">
                        {suggestion.options?.map((option) => (
                          <button key={option} type="button" className="hermes-chat-panel__suggestion-button" onClick={() => onAnswerSuggestion?.(option)} disabled={isBusy}>
                            {option}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </MessageList.Content>
              </MessageList>
              {messageInput}
            </ChatContainer>
          </MainContainer>
        </>
      )}
    </section>
  );
}
