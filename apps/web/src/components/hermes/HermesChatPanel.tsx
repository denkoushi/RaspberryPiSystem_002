import { ChatContainer, MainContainer, Message, MessageInput, MessageList } from '@chatscope/chat-ui-kit-react';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { ProtectedImage } from '../ProtectedImage';

import type { BusinessHermesChatEvidence } from '../../api/domains/assembly';

export type HermesPanelMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  evidence?: readonly BusinessHermesChatEvidence[];
};

export type HermesChatPanelProps = {
  messages: readonly HermesPanelMessage[];
  draft: string;
  isBusy: boolean;
  error: string | null;
  authRequired: string | null;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onReset: () => void;
  onClose: () => void;
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
    evidence.step ? `手順 ${evidence.step}` : null
  ].filter(Boolean).join('・');

  return (
    <article className="hermes-chat-panel__evidence">
      <div>
        <p className="hermes-chat-panel__evidence-title">{evidence.title}</p>
        {meta ? <p className="hermes-chat-panel__evidence-meta">{meta}</p> : null}
        {evidence.text ? <p className="hermes-chat-panel__evidence-text">{evidence.text}</p> : null}
      </div>
      {evidence.imageUrl ? (
        <LazyProtectedImage imageUrl={evidence.imageUrl} alt={`${evidence.title}の写真`} />
      ) : null}
    </article>
  );
}

export default function HermesChatPanel({
  messages,
  draft,
  isBusy,
  error,
  authRequired,
  onDraftChange,
  onSend,
  onReset,
  onClose,
  style
}: HermesChatPanelProps) {
  const reducedMotion = useReducedMotion();
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const editor = panelRef.current?.querySelector<HTMLElement>('[contenteditable="true"]');
    editor?.setAttribute('aria-label', 'Hermesへの質問');
  });

  return (
    <section ref={panelRef} className="hermes-chat-panel" style={style} aria-labelledby="hermes-chat-title" role="region">
      <header className="hermes-chat-panel__header">
        <div>
          <h2 id="hermes-chat-title" className="hermes-chat-panel__title">業務Hermes</h2>
          <p className="hermes-chat-panel__hint">不適合・作業要領を自然な言葉で検索</p>
        </div>
        <div className="hermes-chat-panel__actions">
          <button type="button" className="hermes-chat-panel__action" onClick={onReset} aria-label="会話をリセット">
            リセット
          </button>
          <button type="button" className="hermes-chat-panel__action" onClick={onClose} aria-label="チャットを閉じる">
            閉じる
          </button>
        </div>
      </header>

      {authRequired ? <p className="hermes-chat-panel__status" role="status">{authRequired}</p> : null}
      {error ? <p className="hermes-chat-panel__status hermes-chat-panel__status--error" role="alert">{error}</p> : null}

      <MainContainer className="hermes-chat-panel__main">
        <ChatContainer>
          <MessageList scrollBehavior={reducedMotion ? 'auto' : 'smooth'} autoScrollToBottom>
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
                  {message.evidence?.map((evidence) => (
                    <EvidenceCard key={`${message.id}-${evidence.kind}-${evidence.id}`} evidence={evidence} />
                  ))}
                </Message.CustomContent>
              </Message>
            ))}
          </MessageList>
          <MessageInput
            value={escapeInputHtml(draft)}
            disabled={isBusy}
            sendButton
            attachButton={false}
            placeholder={isBusy ? '回答を取得中…' : '質問を入力…'}
            aria-label="Hermesへの質問"
            onChange={(_innerHtml, textContent) => onDraftChange(textContent)}
            onSend={() => onSend()}
          />
        </ChatContainer>
      </MainContainer>
    </section>
  );
}
