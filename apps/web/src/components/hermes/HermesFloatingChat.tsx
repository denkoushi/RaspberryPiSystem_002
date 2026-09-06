import axios from 'axios';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useLocation } from 'react-router-dom';

import { getResolvedClientKey, sendBusinessHermesChat } from '../../api/client';
import { getApiErrorMessage } from '../../api/errors';
import { useAuth } from '../../contexts/AuthContext';

import type { HermesChatPanelProps, HermesPanelMessage } from './HermesChatPanel';
import type { BusinessHermesChatEvidence } from '../../api/domains/assembly';

import './hermes-floating-chat.css';

const HermesChatPanel = lazy(() => import('./HermesChatPanel'));

const INTRO_MESSAGE: HermesPanelMessage = {
  id: 'hermes-intro',
  role: 'assistant',
  content: '不適合や作業要領について質問できます。品番が分からないときも、自然な言葉で聞いてください。'
};

const ICON_SIZE = 58;
const VIEWPORT_GUTTER = 12;

function clampPosition(left: number, top: number, viewport: { width: number; height: number }) {
  return {
    left: Math.min(Math.max(VIEWPORT_GUTTER, left), Math.max(VIEWPORT_GUTTER, viewport.width - ICON_SIZE - VIEWPORT_GUTTER)),
    top: Math.min(Math.max(VIEWPORT_GUTTER, top), Math.max(VIEWPORT_GUTTER, viewport.height - ICON_SIZE - VIEWPORT_GUTTER))
  };
}

function getViewport() {
  if (typeof window === 'undefined') return { width: 1024, height: 768 };
  return { width: window.innerWidth, height: window.innerHeight };
}

function evidenceForMessage(evidence: readonly BusinessHermesChatEvidence[]) {
  return evidence.length > 0 ? evidence : undefined;
}

export function HermesFloatingChat() {
  const { user, token } = useAuth();
  const location = useLocation();
  const [viewport, setViewport] = useState(getViewport);
  const [position, setPosition] = useState(() => {
    const initialViewport = getViewport();
    return clampPosition(initialViewport.width - ICON_SIZE - 22, initialViewport.height - ICON_SIZE - 22, initialViewport);
  });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<HermesPanelMessage[]>([INTRO_MESSAGE]);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState<string | null>(null);
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible'
  );
  const [clientKey, setClientKey] = useState(() => getResolvedClientKey());
  const clientKeyRef = useRef(clientKey);
  const iconRef = useRef<HTMLButtonElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const identityRef = useRef('');
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
    moved: boolean;
  } | null>(null);
  const suppressNextClickRef = useRef(false);

  const identity = useMemo(
    () => `${token ?? 'anonymous'}:${user?.id ?? 'anonymous'}:${clientKey}:${location.pathname}:${location.search}`,
    [clientKey, location.pathname, location.search, token, user?.id]
  );

  const resetConversation = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    requestIdRef.current += 1;
    setMessages([INTRO_MESSAGE]);
    setDraft('');
    setIsBusy(false);
    setError(null);
    setAuthRequired(null);
  }, []);

  useEffect(() => {
    if (!identityRef.current) {
      identityRef.current = identity;
      return;
    }
    if (identityRef.current === identity) return;
    identityRef.current = identity;
    resetConversation();
  }, [identity, resetConversation]);

  useEffect(() => {
    const updateVisibility = () => setIsDocumentVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  useEffect(() => {
    const updateViewport = () => {
      const nextViewport = getViewport();
      setViewport(nextViewport);
      setPosition((current) => clampPosition(current.left, current.top, nextViewport));
    };
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  useEffect(() => {
    const checkClientKey = () => {
      const nextKey = getResolvedClientKey();
      if (clientKeyRef.current === nextKey) return;
      clientKeyRef.current = nextKey;
      setClientKey(nextKey);
      resetConversation();
    };
    const intervalId = window.setInterval(checkClientKey, 2000);
    window.addEventListener('storage', checkClientKey);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('storage', checkClientKey);
    };
  }, [resetConversation]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const ensureCurrentClientKey = useCallback(() => {
    const nextKey = getResolvedClientKey();
    if (nextKey === clientKey) return true;
    clientKeyRef.current = nextKey;
    setClientKey(nextKey);
    resetConversation();
    return false;
  }, [clientKey, resetConversation]);

  const toggleOpen = useCallback(() => {
    ensureCurrentClientKey();
    setOpen((current) => !current);
  }, [ensureCurrentClientKey]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is unavailable in a few embedded WebViews.
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: position.left,
      startTop: position.top,
      moved: false
    };
  }, [position.left, position.top]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) drag.moved = true;
    if (!drag.moved) return;
    setPosition(clampPosition(drag.startLeft + deltaX, drag.startTop + deltaY, viewport));
  }, [viewport]);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture is unavailable in a few embedded WebViews.
    }
    suppressNextClickRef.current = true;
    window.setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 0);
    if (!drag.moved) toggleOpen();
  }, [toggleOpen]);

  const handlePointerCancel = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleButtonClick = useCallback(() => {
    if (suppressNextClickRef.current) return;
    toggleOpen();
  }, [toggleOpen]);

  const handleButtonKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const distance = event.shiftKey ? 48 : 16;
      const delta = {
        ArrowLeft: { left: -distance, top: 0 },
        ArrowRight: { left: distance, top: 0 },
        ArrowUp: { left: 0, top: -distance },
        ArrowDown: { left: 0, top: distance }
      }[event.key];
      if (delta) setPosition((current) => clampPosition(current.left + delta.left, current.top + delta.top, viewport));
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    suppressNextClickRef.current = true;
    window.setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 0);
    toggleOpen();
  }, [toggleOpen, viewport]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      iconRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const sendMessage = useCallback(async () => {
    const content = draft.trim();
    if (!content || isBusy) return;
    if (!ensureCurrentClientKey()) return;
    setError(null);
    setAuthRequired(null);

    const userMessage: HermesPanelMessage = {
      id: `hermes-user-${Date.now()}-${requestIdRef.current}`,
      role: 'user',
      content
    };
    const history = [...messages.filter((message) => message.id !== INTRO_MESSAGE.id), userMessage]
      .slice(-12)
      .map(({ role, content: messageContent }) => ({ role, content: messageContent }));

    setMessages((current) => [...current, userMessage]);
    setDraft('');
    setIsBusy(true);
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    abortRef.current = controller;
    const requestIdentity = identity;

    try {
      const response = await sendBusinessHermesChat({ scope: 'both', messages: history }, controller.signal);
      const identityChanged = identityRef.current !== requestIdentity || getResolvedClientKey() !== clientKey;
      if (identityChanged) resetConversation();
      if (controller.signal.aborted || requestId !== requestIdRef.current || identityChanged) return;
      const responseText = response.status === 'unavailable'
        ? (response.evidence.length > 0
          ? '検索結果は取得できましたが、Hermesの回答生成は利用できません。表示中の根拠を確認してください。'
          : response.message ?? 'Hermesが回答を準備できませんでした。少し待って再試行してください。')
        : response.message ?? response.clarificationMessage ?? (
          response.needsClarification ? '条件をもう少し指定してください。' : null
        ) ?? (response.evidence.length > 0 ? '関連する根拠を表示します。' : null);
      if (responseText) {
        setMessages((current) => [
          ...current,
          {
            id: `hermes-assistant-${requestId}`,
            role: 'assistant',
            content: responseText,
            evidence: evidenceForMessage(response.evidence)
          }
        ]);
      }
      if (response.status === 'unavailable') {
        setError(response.evidence.length > 0
          ? '回答生成が利用できないため、根拠カードのみ表示しています。'
          : response.message ?? 'Hermesが回答を準備できませんでした。少し待って再試行してください。');
      }
    } catch (requestError) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      const status = axios.isAxiosError(requestError) ? requestError.response?.status : undefined;
      if (status === 401 || status === 403) {
        setAuthRequired('この検索にはログインまたは端末キーの権限が必要です。');
      } else {
        setError(getApiErrorMessage(requestError, 'Hermesに接続できませんでした。通信状態を確認してください。'));
      }
    } finally {
      if (requestId === requestIdRef.current) {
        abortRef.current = null;
        setIsBusy(false);
      }
    }
  }, [clientKey, draft, ensureCurrentClientKey, identity, isBusy, messages, resetConversation]);

  const closePanel = useCallback(() => {
    setOpen(false);
    iconRef.current?.focus();
  }, []);

  const panelWidth = Math.min(380, Math.max(280, viewport.width - 24));
  const spaceAboveIcon = Math.max(180, position.top - VIEWPORT_GUTTER * 2);
  const spaceBelowIcon = Math.max(180, viewport.height - position.top - ICON_SIZE - VIEWPORT_GUTTER * 2);
  const opensAbove = position.top > viewport.height / 2 || spaceAboveIcon >= spaceBelowIcon;
  const panelHeight = Math.min(
    560,
    Math.max(180, viewport.height - VIEWPORT_GUTTER * 2),
    opensAbove ? spaceAboveIcon : spaceBelowIcon
  );
  const panelLeft = Math.min(
    Math.max(VIEWPORT_GUTTER, position.left + ICON_SIZE / 2 - panelWidth / 2),
    Math.max(VIEWPORT_GUTTER, viewport.width - panelWidth - VIEWPORT_GUTTER)
  );
  const panelTop = opensAbove
    ? Math.max(VIEWPORT_GUTTER, position.top - panelHeight - 12)
    : Math.min(position.top + ICON_SIZE + 12, Math.max(VIEWPORT_GUTTER, viewport.height - panelHeight - VIEWPORT_GUTTER));
  const panelStyle = {
    left: panelLeft,
    top: panelTop,
    width: panelWidth,
    height: panelHeight
  };
  const iconStyle = { left: position.left, top: position.top };
  const panelProps: HermesChatPanelProps = {
    messages,
    draft,
    isBusy,
    error,
    authRequired,
    onDraftChange: setDraft,
    onSend: sendMessage,
    onReset: resetConversation,
    onClose: closePanel
  };

  return (
    <div className="hermes-floating-root">
      <button
        ref={iconRef}
        type="button"
        className={`hermes-floating-trigger${isDocumentVisible ? '' : ' hermes-floating-trigger--paused'}`}
        style={iconStyle}
        aria-label="業務Hermesチャットを開く。ドラッグで移動できます"
        aria-expanded={open}
        title="業務Hermesチャット（ドラッグで移動）"
        onClick={handleButtonClick}
        onKeyDown={handleButtonKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <span className="hermes-floating-trigger__surface" aria-hidden="true">
          <span className="hermes-floating-trigger__streams">
            {Array.from({ length: 8 }, (_, index) => (
              <span
                key={index}
                className="hermes-floating-trigger__stream"
                style={{ '--hermes-stream-index': index } as CSSProperties}
              >
                1<br />0<br />1
              </span>
            ))}
          </span>
        </span>
        <span className="hermes-floating-trigger__glyph" aria-hidden="true">H</span>
      </button>

      {open ? (
        <Suspense fallback={<div className="hermes-chat-panel" style={panelStyle} role="status">チャットを準備中…</div>}>
          <HermesChatPanel {...panelProps} style={panelStyle} />
        </Suspense>
      ) : null}
    </div>
  );
}

export default HermesFloatingChat;
