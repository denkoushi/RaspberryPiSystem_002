import { ChatContainer, MainContainer, Message, MessageInput, MessageList } from '@chatscope/chat-ui-kit-react';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { renderSignageCanvasPreview } from '../../api/domains/signage';
import { ProtectedImage } from '../ProtectedImage';

import { HermesA2uiPreview } from './HermesA2uiPreview';

import type {
  BusinessHermesChatEvidence,
  BusinessHermesConsultationDetail,
  BusinessHermesConsultationItem,
  BusinessHermesSignageCanvasElement,
  BusinessHermesSignageProposal
} from '../../api/domains/assembly';

export type HermesPanelMessage = {
  feedback?: 'pending' | 'helpful' | 'unhelpful';
  id: string;
  role: 'user' | 'assistant';
  content: string;
  evidence?: readonly BusinessHermesChatEvidence[];
  evidenceVisible?: boolean;
  evidenceVisibleIds?: readonly string[];
  recordIds?: readonly string[];
  recordView?: 'summary' | 'detail';
  selection?: { prompt: string; option: string };
  createdAt?: string;
};

export type HermesConsultationSuggestion = {
  options?: string[];
  title?: string;
  relatedIdentifiers: string[];
  prompt: string;
  signageProposal?: BusinessHermesSignageProposal;
};

export type HermesKnowledgeMode = 'search' | 'knowledge' | 'record-pilot';

export type HermesChatPanelProps = {
  conversationExtension?: ReactNode;
  attachmentControl?: ReactNode;
  knowledgeMode?: HermesKnowledgeMode;
  recordPilotAvailable?: boolean;
  onKnowledgeModeChange?: (mode: HermesKnowledgeMode) => void;
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
  onFeedback?: (messageId: string, verdict: 'helpful' | 'unhelpful') => void;
  feedbackBusy?: boolean;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onReset: () => void;
  onClose: () => void;
  onStop?: () => void;
  isExpanded?: boolean;
  onToggleSize?: () => void;
  onNewConsultation?: () => void;
  onScan?: () => void;
  onSelectConsultation?: (consultationId: string) => void;
  onLoadOlderMessages?: () => void;
  suggestion?: HermesConsultationSuggestion | null;
  onAnswerSuggestion?: (answer: string) => void;
  selectionNotice?: string | null;
  activityStatus?: string | null;
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

function ResetIcon() {
  return (
    <svg className="hermes-chat-panel__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <polyline points="3 4 3 10 9 10" />
    </svg>
  );
}

function ResizeIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg className="hermes-chat-panel__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {expanded ? <><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="10" y1="14" x2="3" y2="21" /><line x1="14" y1="10" x2="21" y2="3" /></> : <><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></>}
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="hermes-chat-panel__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="5" y1="5" x2="19" y2="19" />
      <line x1="19" y1="5" x2="5" y2="19" />
    </svg>
  );
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

function renderMessageContent(content: string) {
  return content.split(/\n{2,}/u).map((block, index) => {
    const lines = block.split('\n');
    const heading = lines.length === 1 ? lines[0]?.match(/^\*\*(.+)\*\*$/u) : null;
    const headingWithBody = lines.length > 1 ? lines[0]?.match(/^\*\*(.+)\*\*$/u) : null;
    return (
      <span key={`${index}-${block.slice(0, 24)}`} className="hermes-chat-panel__message-group">
        {heading || headingWithBody ? <span className="hermes-chat-panel__message-block hermes-chat-panel__message-heading">{(heading ?? headingWithBody)?.[1]}</span> : null}
        {headingWithBody ? <span className="hermes-chat-panel__message-block">{lines.slice(1).join('\n')}</span> : !heading ? <span className="hermes-chat-panel__message-block">{block}</span> : null}
      </span>
    );
  });
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
    evidence.originDepartmentName ? `起因部署 ${evidence.originDepartmentName}` : null,
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

type HermesRecordField = NonNullable<BusinessHermesChatEvidence['displayFields']>['summary'][number];

function recordFieldsSignature(fields: readonly HermesRecordField[]): string {
  return fields.map((field) => JSON.stringify([field.key, field.label, field.value])).sort().join('\u0000');
}

function RecordCard({ evidence, view }: { evidence: BusinessHermesChatEvidence; view: 'summary' | 'detail' }) {
  const [currentView, setCurrentView] = useState<'summary' | 'detail'>(view);
  const summaryFields = evidence.displayFields?.summary ?? [];
  const detailFields = evidence.displayFields?.detail ?? [];
  const fields = currentView === 'detail' ? detailFields : summaryFields;
  const canToggle = summaryFields.length > 0
    && detailFields.length > 0
    && recordFieldsSignature(summaryFields) !== recordFieldsSignature(detailFields);
  if (fields.length === 0) return null;
  return (
    <article className="hermes-chat-panel__record" data-record-view={currentView}>
      <div className="hermes-chat-panel__record-header">
        <p className="hermes-chat-panel__record-title">{evidence.title}</p>
        {canToggle ? (
          <button
            type="button"
            className="hermes-chat-panel__record-toggle"
            onClick={() => setCurrentView((previousView) => previousView === 'summary' ? 'detail' : 'summary')}
          >
            {currentView === 'summary' ? '詳細を見る' : '概要に戻す'}
          </button>
        ) : null}
      </div>
      <dl className="hermes-chat-panel__record-fields">
        {fields.map((field) => (
          <div key={`${field.key}-${field.label}`} className="hermes-chat-panel__record-field">
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

const SIGNAGE_DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const SIGNAGE_APPROVAL_OPTION = 'このサイネージ設定を適用する';

function safeSignageColor(value: string | undefined, fallback: string): string {
  return value && /^#[0-9a-fA-F]{6}$/u.test(value) ? value : fallback;
}

function signageCanvasElementLabel(element: BusinessHermesSignageCanvasElement): string {
  if (element.kind === 'text') return element.text?.replace(/\s+/gu, ' ').trim() || '文字';
  return `${element.title ?? element.rendererType ?? '可視化'} / ${element.dataSourceType ?? 'データソース'}`;
}

function SignageProposalPreview({
  proposal,
  onPreviewReady
}: {
  proposal: BusinessHermesSignageProposal;
  onPreviewReady?: (ready: boolean) => void;
}) {
  const canvas = proposal.canvas;
  const a2ui = proposal.a2ui;
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const scheduleChangeRows = [
    proposal.scheduleName ? ['スケジュール', proposal.scheduleName] : null,
    proposal.deviceScopeKey ? ['配信スコープ', proposal.deviceScopeKey] : null,
    proposal.targetClientDeviceIds ? ['配信先', `${proposal.targetClientDeviceIds.length}台の登録済み端末`] : null,
    proposal.dayOfWeek ? ['曜日', proposal.dayOfWeek.map((day) => SIGNAGE_DAY_LABELS[day] ?? String(day)).join('・')] : null,
    proposal.startTime || proposal.endTime ? ['時間帯', `${proposal.startTime ?? '現在値'}〜${proposal.endTime ?? '現在値'}`] : null,
    proposal.priority !== undefined ? ['優先度', String(proposal.priority)] : null,
    proposal.enabled !== undefined ? ['状態', proposal.enabled ? '有効' : '停止'] : null,
    proposal.slideIntervalSeconds !== undefined ? ['ページ切替', `${proposal.slideIntervalSeconds}秒`] : null,
    proposal.seibanPerPage !== undefined ? ['1ページの製番数', `${proposal.seibanPerPage}件`] : null
  ].filter((row): row is [string, string] => row !== null);

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;
    setPreviewImageUrl(null);
    setPreviewFailed(false);
    if (!canvas && !a2ui) {
      onPreviewReady?.(true);
      return () => { disposed = true; };
    }
    if (a2ui) {
      return () => { disposed = true; };
    }
    if (!canvas) return () => { disposed = true; };
    onPreviewReady?.(false);

    void renderSignageCanvasPreview(canvas)
      .then((blob) => {
        if (disposed || typeof URL.createObjectURL !== 'function') {
          if (!disposed && typeof URL.createObjectURL !== 'function') {
            setPreviewFailed(true);
            onPreviewReady?.(false);
          }
          return;
        }
        const url = URL.createObjectURL(blob);
        if (disposed) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setPreviewImageUrl(url);
        onPreviewReady?.(true);
      })
      .catch(() => {
        if (!disposed) {
          setPreviewFailed(true);
          onPreviewReady?.(false);
        }
      });

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [a2ui, canvas, onPreviewReady, previewAttempt]);

  return (
    <div className="hermes-chat-panel__signage-preview" data-testid="signage-proposal-preview">
      <div className="hermes-chat-panel__signage-preview-header">
        <strong>{proposal.scheduleId ? '既存スケジュールの変更案' : '新規サイネージ画面案'}</strong>
        <span>{a2ui ? 'プレビュー' : canvas ? `${canvas.width}×${canvas.height}` : '標準進捗画面'}</span>
      </div>
      {scheduleChangeRows.length > 0 ? (
        <dl className="hermes-chat-panel__signage-change-list">
          {scheduleChangeRows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {a2ui ? (
        <HermesA2uiPreview proposal={a2ui} onReady={onPreviewReady} />
      ) : canvas ? (
        previewImageUrl ? (
          <img
            className="hermes-chat-panel__signage-rendered-preview"
            src={previewImageUrl}
            alt={`サイネージの実データプレビュー。${canvas.elements.length}要素`}
          />
        ) : (
          <>
            {!previewFailed ? <p className="hermes-chat-panel__signage-preview-loading" role="status">実データプレビューを生成中…</p> : (
              <div className="hermes-chat-panel__signage-preview-error" role="status">
                <span>実データプレビューを取得できないため、適用操作を無効にしています。</span>
                <button type="button" onClick={() => setPreviewAttempt((attempt) => attempt + 1)}>実データプレビューを再試行</button>
              </div>
            )}
            <div
              className="hermes-chat-panel__signage-canvas"
              role="img"
              aria-label={`サイネージキャンバスの構成プレビュー。${canvas.elements.length}要素`}
              style={{
                backgroundColor: safeSignageColor(canvas.backgroundColor, '#020617'),
                aspectRatio: `${canvas.width} / ${canvas.height}`
              }}
            >
              {canvas.elements.map((element) => {
                const elementStyle: CSSProperties = {
                  left: `${(element.x / canvas.width) * 100}%`,
                  top: `${(element.y / canvas.height) * 100}%`,
                  width: `${(element.width / canvas.width) * 100}%`,
                  height: `${(element.height / canvas.height) * 100}%`,
                  color: safeSignageColor(element.style?.color, '#f8fafc'),
                  textAlign: element.style?.align === 'middle' ? 'center' : element.style?.align === 'end' ? 'right' : 'left',
                  fontWeight: element.style?.fontWeight ?? 'normal'
                };
                return (
                  <div
                    key={element.id}
                    className={`hermes-chat-panel__signage-canvas-element hermes-chat-panel__signage-canvas-element--${element.kind}`}
                    style={elementStyle}
                    title={signageCanvasElementLabel(element)}
                  >
                    {element.kind === 'text' ? element.text : (
                      <>
                        <span className="hermes-chat-panel__signage-canvas-element-title">{element.title ?? element.rendererType ?? '可視化'}</span>
                        <span className="hermes-chat-panel__signage-canvas-element-source">{element.dataSourceType ?? 'データソース'}</span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )
      ) : (
        <p className="hermes-chat-panel__signage-preview-note">既存の表示内容を保持し、指定された運用設定だけを変更します。</p>
      )}
      <p className="hermes-chat-panel__signage-preview-note">表示されていない設定は現在値を保持します。反映にはADMINまたはMANAGERの承認が必要です。</p>
    </div>
  );
}

export default function HermesChatPanel({
  conversationExtension,
  attachmentControl,
  knowledgeMode = 'search',
  recordPilotAvailable = false,
  onKnowledgeModeChange,
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
  onFeedback,
  feedbackBusy = false,
  onDraftChange,
  onSend,
  onReset,
  onClose,
  onStop,
  isExpanded = false,
  onToggleSize,
  onNewConsultation,
  onScan,
  onSelectConsultation,
  onLoadOlderMessages,
  suggestion = null,
  onAnswerSuggestion,
  selectionNotice = null,
  activityStatus = null,
  style
}: HermesChatPanelProps) {
  const reducedMotion = useReducedMotion();
  const panelRef = useRef<HTMLElement | null>(null);
  const signagePreviewToken = suggestion?.signageProposal?.canvas || suggestion?.signageProposal?.a2ui
    ? JSON.stringify({ canvas: suggestion.signageProposal.canvas, a2ui: suggestion.signageProposal.a2ui })
    : '';
  const [signagePreviewReady, setSignagePreviewReady] = useState(() => signagePreviewToken === '');

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
      placeholder={isBusy ? '回答を取得中…' : isConsultationsLoading ? '相談一覧を準備中…' : knowledgeMode === 'record-pilot' ? '自然文で架空記録を検索…' : '自然な言葉で相談…'}
      aria-label="Hermesへの質問"
      onChange={(_innerHtml, textContent) => onDraftChange(textContent)}
      onSend={() => onSend()}
    />
  );

  return (
    <section ref={panelRef} className="hermes-chat-panel" style={style} aria-label="Hermesチャット" role="region">
      <header className="hermes-chat-panel__header">
        <div className="hermes-chat-panel__header-main">
          {onKnowledgeModeChange ? (
            <div className="hermes-chat-panel__mode-selector">
              <button type="button" className={`hermes-chat-panel__mode${knowledgeMode === 'search' ? ' hermes-chat-panel__mode--selected' : ''}`} aria-pressed={knowledgeMode === 'search'} onClick={() => onKnowledgeModeChange('search')}>検索</button>
              <button type="button" className={`hermes-chat-panel__mode${knowledgeMode === 'knowledge' ? ' hermes-chat-panel__mode--selected' : ''}`} aria-pressed={knowledgeMode === 'knowledge'} onClick={() => onKnowledgeModeChange('knowledge')}>ナレッジ</button>
              {recordPilotAvailable ? <button type="button" className={`hermes-chat-panel__mode${knowledgeMode === 'record-pilot' ? ' hermes-chat-panel__mode--selected' : ''}`} aria-pressed={knowledgeMode === 'record-pilot'} onClick={() => onKnowledgeModeChange('record-pilot')}>JEV記録</button> : null}
            </div>
          ) : null}
          <div className="hermes-chat-panel__header-title">
            {mode === 'consultations' && activeConsultation ? (
              <>
                <h2 id="hermes-chat-title" className="hermes-chat-panel__title">{consultationLabel(activeConsultation)}</h2>
                <p className="hermes-chat-panel__hint">相談を続ける</p>
              </>
            ) : null}
          </div>
        </div>
        <div className="hermes-chat-panel__actions">
          {mode === 'consultations' && onNewConsultation ? (
            <button type="button" className="hermes-chat-panel__action" onClick={onNewConsultation} aria-label="新しい相談を始める">
              新規
            </button>
          ) : null}
          {mode === 'consultations' && onScan ? (
            <button
              type="button"
              className="hermes-chat-panel__action"
              onClick={onScan}
              disabled={isBusy || isConsultationsLoading || isConsultationDetailLoading || isMessageHistoryLoading}
              aria-label="バーコードをスキャン"
            >
              Scan
            </button>
          ) : null}
          {mode === 'consultations' && activeConsultation ? (
            <button type="button" className="hermes-chat-panel__action" onClick={onReset} aria-label="相談一覧に戻る">
              一覧
            </button>
          ) : (
            <button type="button" className="hermes-chat-panel__action" onClick={onReset} aria-label="会話をリセット">
              <ResetIcon />
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
              <ResizeIcon expanded={isExpanded} />
            </button>
          ) : null}
          <button type="button" className="hermes-chat-panel__action" onClick={onClose} aria-label="チャットを閉じる">
            <CloseIcon />
          </button>
        </div>
      </header>

      {authRequired ? <p className="hermes-chat-panel__status" role="status">{authRequired}</p> : null}
      {conversationExtension}
      {error ? <p className="hermes-chat-panel__status hermes-chat-panel__status--error" role="alert">{error}</p> : null}
      {consultationError ? <p className="hermes-chat-panel__status hermes-chat-panel__status--error" role="alert">{consultationError}</p> : null}
      {selectionNotice ? <p className="hermes-chat-panel__status hermes-chat-panel__status--selection" role="status">{selectionNotice}</p> : null}
      {activityStatus ? <p className="hermes-chat-panel__status" role="status">{activityStatus}</p> : null}
      {isBusy && !activityStatus ? <p className="hermes-chat-panel__status" role="status">回答を考えています…{onStop ? ' 停止できます。' : ''}</p> : null}

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
                        {message.selection ? (
                          <p className="hermes-chat-panel__message-selection" role="status">「{message.selection.option}」が選択されました。</p>
                        ) : (
                          <div className="hermes-chat-panel__message">{message.role === 'assistant' ? renderMessageContent(message.content) : message.content}</div>
                        )}
                        {message.recordIds?.length && message.evidence?.length ? message.recordIds.flatMap((recordId) => {
                          const evidence = message.evidence?.find((candidate) => `${candidate.kind}:${candidate.id}` === recordId);
                          return evidence ? [<RecordCard key={`${message.id}-record-${recordId}-${message.recordView ?? 'summary'}`} evidence={evidence} view={message.recordView ?? 'summary'} />] : [];
                        }) : null}
                        {message.evidenceVisible !== false ? (message.evidenceVisibleIds
                          ? message.evidence?.filter((evidence) => message.evidenceVisibleIds?.includes(`${evidence.kind}:${evidence.id}`))
                          : message.evidence)?.map((evidence) => (
                          <EvidenceCard key={`${message.id}-${evidence.kind}-${evidence.id}`} evidence={evidence} />
                        )) : null}
                        {message.role === 'assistant' && message.feedback && onFeedback ? (
                          <div role="group" aria-label="回答の評価" className="hermes-chat-panel__suggestion-actions">
                            <button type="button" className="hermes-chat-panel__suggestion-button" aria-pressed={message.feedback === 'helpful'} disabled={isBusy || feedbackBusy} onClick={() => onFeedback(message.id, 'helpful')}>役立った</button>
                            <button type="button" className="hermes-chat-panel__suggestion-button" aria-pressed={message.feedback === 'unhelpful'} disabled={isBusy || feedbackBusy} onClick={() => onFeedback(message.id, 'unhelpful')}>合わない</button>
                            {message.feedback !== 'pending' ? <span role="status">評価を保存しました</span> : null}
                          </div>
                        ) : null}
                      </Message.CustomContent>
                    </Message>
                  ))}
                  {suggestion ? (
                    <div className="hermes-chat-panel__suggestion" role="group" aria-label="Hermesからの候補確認">
                      {suggestion.signageProposal ? <SignageProposalPreview proposal={suggestion.signageProposal} onPreviewReady={setSignagePreviewReady} /> : null}
                      <p className="hermes-chat-panel__suggestion-prompt">{suggestion.prompt}</p>
                      <div className="hermes-chat-panel__suggestion-actions">
                        {suggestion.options?.map((option) => (
                          <button
                            key={option}
                            type="button"
                            className="hermes-chat-panel__suggestion-button"
                            onClick={() => onAnswerSuggestion?.(option)}
                            disabled={isBusy || (option === SIGNAGE_APPROVAL_OPTION && Boolean(suggestion.signageProposal?.canvas || suggestion.signageProposal?.a2ui) && !signagePreviewReady)}
                          >
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
      {attachmentControl}
    </section>
  );
}
