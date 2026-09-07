import axios from 'axios';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useLocation } from 'react-router-dom';

import {
  cancelBusinessHermesConsultation,
  createBusinessHermesConsultation,
  getBusinessHermesConsultation,
  getResolvedClientKey,
  listBusinessHermesConsultations,
  sendBusinessHermesChat,
  sendBusinessHermesConsultationMessage,
  type BusinessHermesChatResponse,
  type BusinessHermesConsultationChatResponse,
  type BusinessHermesConsultationDetail,
  type BusinessHermesConsultationItem
} from '../../api/client';
import { getApiErrorMessage } from '../../api/errors';
import { useAuth } from '../../contexts/AuthContext';

import type { HermesChatPanelProps, HermesPanelMessage, HermesConsultationSuggestion } from './HermesChatPanel';
import type { BusinessHermesChatEvidence } from '../../api/domains/assembly';

import './hermes-floating-chat.css';

const HermesChatPanel = lazy(() => import('./HermesChatPanel'));

const INTRO_MESSAGE: HermesPanelMessage = {
  id: 'hermes-intro',
  role: 'assistant',
  content: 'ご相談をどうぞ。'
};

type ConsultationMode = 'loading' | 'available' | 'legacy';

const ICON_SIZE = 58;
const VIEWPORT_GUTTER = 12;
const PANEL_STANDARD_WIDTH = 380;
const PANEL_STANDARD_HEIGHT = 560;

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

function messagesFromConsultation(detail: BusinessHermesConsultationDetail): HermesPanelMessage[] {
  return detail.messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    evidence: message.evidence,
    evidenceVisible: message.evidenceVisible,
    createdAt: message.createdAt
  }));
}

function mergeMessages(older: HermesPanelMessage[], current: HermesPanelMessage[]): HermesPanelMessage[] {
  const seen = new Set<string>();
  return [...older, ...current].filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
}

function isConsultationDetail(
  consultation: BusinessHermesConsultationItem | BusinessHermesConsultationDetail
): consultation is BusinessHermesConsultationDetail {
  return Array.isArray((consultation as BusinessHermesConsultationDetail).messages);
}

function pendingConfirmation(detail: BusinessHermesConsultationDetail): HermesConsultationSuggestion | null {
  const latest = detail.messages.at(-1);
  const confirmation = latest?.role === 'assistant' ? latest.confirmation : undefined;
  return confirmation ? { ...confirmation, relatedIdentifiers: confirmation.relatedIdentifiers ?? [] } : null;
}

function responseText(response: BusinessHermesChatResponse | BusinessHermesConsultationChatResponse): string | null {
  if (response.status === 'unavailable') {
    return response.evidence.length > 0
      ? '検索結果は取得できましたが、Hermesの回答生成は利用できません。表示中の根拠を確認してください。'
      : response.reasonCode === 'HERMES_NOT_CONFIGURED'
        ? 'Hermesの能力設定が未有効です。管理者の設定後に再試行してください。'
      : response.message ?? '回答を準備できませんでした。少し待って再試行してください。';
  }
  return response.message ?? response.clarificationMessage ?? (
    response.needsClarification ? '条件をもう少し教えてください。' : null
  ) ?? (response.evidence.length > 0 ? '関連する根拠を表示します。' : null);
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
  const [isPanelExpanded, setIsPanelExpanded] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<HermesPanelMessage[]>([INTRO_MESSAGE]);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState<string | null>(null);
  const [consultationMode, setConsultationMode] = useState<ConsultationMode>('loading');
  const [consultations, setConsultations] = useState<BusinessHermesConsultationItem[]>([]);
  const [activeConsultation, setActiveConsultation] = useState<BusinessHermesConsultationDetail | null>(null);
  const [consultationSuggestion, setConsultationSuggestion] = useState<HermesConsultationSuggestion | null>(null);
  const [isConsultationsLoading, setIsConsultationsLoading] = useState(false);
  const [isConsultationDetailLoading, setIsConsultationDetailLoading] = useState(false);
  const [isMessageHistoryLoading, setIsMessageHistoryLoading] = useState(false);
  const [messageHistoryError, setMessageHistoryError] = useState<string | null>(null);
  const [consultationError, setConsultationError] = useState<string | null>(null);
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible'
  );
  const [clientKey, setClientKey] = useState(() => getResolvedClientKey());
  const clientKeyRef = useRef(clientKey);
  const iconRef = useRef<HTMLButtonElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messageHistoryAbortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const consultationRequestIdRef = useRef(0);
  const messageHistoryRequestIdRef = useRef(0);
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

  const invalidateChatRequest = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    requestIdRef.current += 1;
    setIsBusy(false);
  }, []);

  const invalidateMessageHistory = useCallback(() => {
    messageHistoryAbortRef.current?.abort();
    messageHistoryAbortRef.current = null;
    messageHistoryRequestIdRef.current += 1;
    setIsMessageHistoryLoading(false);
  }, []);

  const resetConversation = useCallback((options: { clearConsultations?: boolean } = {}) => {
    invalidateChatRequest();
    invalidateMessageHistory();
    consultationRequestIdRef.current += 1;
    setMessages([INTRO_MESSAGE]);
    setActiveConsultation(null);
    setConsultationSuggestion(null);
    setDraft('');
    setIsBusy(false);
    setError(null);
    setAuthRequired(null);
    setConsultationError(null);
    setIsConsultationsLoading(false);
    setIsConsultationDetailLoading(false);
    setMessageHistoryError(null);
    if (options.clearConsultations) {
      setConsultations([]);
      setConsultationMode('loading');
    }
  }, [invalidateChatRequest, invalidateMessageHistory]);

  useEffect(() => {
    if (!identityRef.current) {
      identityRef.current = identity;
      return;
    }
    if (identityRef.current === identity) return;
    identityRef.current = identity;
    resetConversation({ clearConsultations: true });
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
      resetConversation({ clearConsultations: true });
    };
    const intervalId = window.setInterval(checkClientKey, 2000);
    window.addEventListener('storage', checkClientKey);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('storage', checkClientKey);
    };
  }, [resetConversation]);

  useEffect(() => () => {
    abortRef.current?.abort();
    messageHistoryAbortRef.current?.abort();
  }, []);

  const ensureCurrentClientKey = useCallback(() => {
    const nextKey = getResolvedClientKey();
    if (nextKey === clientKey) return true;
    clientKeyRef.current = nextKey;
    setClientKey(nextKey);
    resetConversation({ clearConsultations: true });
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

  useEffect(() => {
    if (!open || consultationMode !== 'loading') return;
    const controller = new AbortController();
    const requestIdentity = identity;
    setIsConsultationsLoading(true);
    setConsultationError(null);
    void listBusinessHermesConsultations(controller.signal)
      .then(({ consultations: items, enabled }) => {
        if (controller.signal.aborted || identityRef.current !== requestIdentity) return;
        if (!enabled) {
          setConsultations([]);
          setConsultationMode('legacy');
          return;
        }
        setConsultations(items);
        setConsultationMode('available');
      })
      .catch((requestError) => {
        if (controller.signal.aborted || identityRef.current !== requestIdentity) return;
        const status = axios.isAxiosError(requestError) ? requestError.response?.status : undefined;
        if (status === 404 || status === 405) {
          setConsultationMode('legacy');
          return;
        }
        setConsultationMode('available');
        setConsultationError(getApiErrorMessage(requestError, '相談一覧を読み込めませんでした。'));
      })
      .finally(() => {
        if (!controller.signal.aborted && identityRef.current === requestIdentity) setIsConsultationsLoading(false);
      });
    return () => controller.abort();
  }, [consultationMode, identity, open]);

  const replaceConsultationInList = useCallback((next: BusinessHermesConsultationItem) => {
    setConsultations((current) => {
      const without = current.filter((item) => item.id !== next.id);
      return [next, ...without];
    });
  }, []);

  const selectConsultation = useCallback(async (consultationId: string) => {
    if (consultationMode !== 'available') return;
    invalidateChatRequest();
    invalidateMessageHistory();
    const requestId = ++consultationRequestIdRef.current;
    const requestIdentity = identity;
    setActiveConsultation(null);
    setConsultationSuggestion(null);
    setMessages([INTRO_MESSAGE]);
    setConsultationError(null);
    setMessageHistoryError(null);
    setIsConsultationDetailLoading(true);
    try {
      const detail = await getBusinessHermesConsultation(consultationId);
      if (requestId !== consultationRequestIdRef.current || identityRef.current !== requestIdentity) return;
      setActiveConsultation(detail);
      setMessages(messagesFromConsultation(detail));
      setConsultationSuggestion(pendingConfirmation(detail));
      replaceConsultationInList(detail);
    } catch (requestError) {
      if (requestId !== consultationRequestIdRef.current || identityRef.current !== requestIdentity) return;
      setConsultationError(getApiErrorMessage(requestError, '相談を開けませんでした。'));
    } finally {
      if (requestId === consultationRequestIdRef.current) setIsConsultationDetailLoading(false);
    }
  }, [consultationMode, identity, invalidateChatRequest, invalidateMessageHistory, replaceConsultationInList]);

  const loadOlderMessages = useCallback(async () => {
    const consultation = activeConsultation;
    const messageCursor = consultation?.messagesNextCursor;
    if (consultationMode !== 'available' || !consultation || !messageCursor || isMessageHistoryLoading || isBusy) return;

    invalidateMessageHistory();
    const requestId = messageHistoryRequestIdRef.current;
    const requestIdentity = identity;
    const controller = new AbortController();
    messageHistoryAbortRef.current = controller;
    setMessageHistoryError(null);
    setIsMessageHistoryLoading(true);

    try {
      const olderPage = await getBusinessHermesConsultation(consultation.id, messageCursor, controller.signal);
      if (controller.signal.aborted || requestId !== messageHistoryRequestIdRef.current || identityRef.current !== requestIdentity) return;
      setActiveConsultation((current) => {
        if (!current || current.id !== olderPage.id) return current;
        return {
          ...current,
          messagesNextCursor: olderPage.messagesNextCursor,
          messages: [...olderPage.messages, ...current.messages.filter((message) => !olderPage.messages.some((older) => older.id === message.id))]
        };
      });
      setMessages((current) => mergeMessages(messagesFromConsultation(olderPage), current.filter((message) => message.id !== INTRO_MESSAGE.id)));
    } catch (requestError) {
      if (controller.signal.aborted || requestId !== messageHistoryRequestIdRef.current || identityRef.current !== requestIdentity) return;
      setMessageHistoryError(getApiErrorMessage(requestError, '以前の履歴を読み込めませんでした。'));
    } finally {
      if (requestId === messageHistoryRequestIdRef.current) {
        messageHistoryAbortRef.current = null;
        setIsMessageHistoryLoading(false);
      }
    }
  }, [activeConsultation, consultationMode, identity, invalidateMessageHistory, isBusy, isMessageHistoryLoading]);

  const createConsultation = useCallback(async () => {
    if (consultationMode !== 'available') return;
    invalidateChatRequest();
    invalidateMessageHistory();
    const requestId = ++consultationRequestIdRef.current;
    const requestIdentity = identity;
    setActiveConsultation(null);
    setConsultationSuggestion(null);
    setMessages([INTRO_MESSAGE]);
    setDraft('');
    setConsultationError(null);
    setMessageHistoryError(null);
    setIsConsultationDetailLoading(true);
    try {
      const detail = await createBusinessHermesConsultation();
      if (requestId !== consultationRequestIdRef.current || identityRef.current !== requestIdentity) return;
      setActiveConsultation(detail);
      setMessages(messagesFromConsultation(detail));
      replaceConsultationInList(detail);
    } catch (requestError) {
      if (requestId !== consultationRequestIdRef.current || identityRef.current !== requestIdentity) return;
      setConsultationError(getApiErrorMessage(requestError, '新しい相談を始められませんでした。'));
    } finally {
      if (requestId === consultationRequestIdRef.current) setIsConsultationDetailLoading(false);
    }
  }, [consultationMode, identity, invalidateChatRequest, invalidateMessageHistory, replaceConsultationInList]);

  const resetActiveConversation = useCallback(() => {
    if (consultationMode !== 'available') {
      resetConversation();
      return;
    }
    invalidateChatRequest();
    invalidateMessageHistory();
    consultationRequestIdRef.current += 1;
    setActiveConsultation(null);
    setConsultationMode('loading');
    setConsultationSuggestion(null);
    setMessages([INTRO_MESSAGE]);
    setDraft('');
    setIsBusy(false);
    setError(null);
    setConsultationError(null);
    setIsConsultationsLoading(false);
    setIsConsultationDetailLoading(false);
    setMessageHistoryError(null);
  }, [consultationMode, invalidateChatRequest, invalidateMessageHistory, resetConversation]);

  const stopRequest = useCallback(() => {
    if (!isBusy) return;
    invalidateChatRequest();
    setIsConsultationDetailLoading(false);
    setError('回答を中止しました。必要ならもう一度送信してください。');
    if (activeConsultation) {
      const stopRequestId = requestIdRef.current;
      setIsBusy(true);
      void cancelBusinessHermesConsultation(activeConsultation.id)
        .catch(() => {
          if (requestIdRef.current === stopRequestId) setError('停止を確認できませんでした。少し待ってから再送信してください。');
        })
        .finally(() => {
          if (requestIdRef.current === stopRequestId) setIsBusy(false);
        });
    }
  }, [activeConsultation, invalidateChatRequest, isBusy]);

  const sendMessage = useCallback(async (messageOverride?: string) => {
    const content = (typeof messageOverride === 'string' ? messageOverride : draft).trim();
    if (!content || isBusy) return;
    if (!ensureCurrentClientKey()) return;
    if (consultationMode === 'loading') {
      setConsultationError('相談を準備しています。少し待ってから送信してください。');
      return;
    }
    setError(null);
    setAuthRequired(null);
    setConsultationError(null);
    setConsultationSuggestion(null);

    const userMessage: HermesPanelMessage = {
      id: `hermes-user-${Date.now()}-${requestIdRef.current}`,
      role: 'user',
      content,
      createdAt: new Date().toISOString()
    };
    const history = [...messages.filter((message) => message.id !== INTRO_MESSAGE.id), userMessage]
      .slice(-12)
      .map(({ role, content: messageContent }) => ({ role, content: messageContent }));

    setMessages((current) => [...current, userMessage]);
    if (activeConsultation) {
      setActiveConsultation((current) => current ? {
        ...current,
        messages: [...current.messages, {
          id: userMessage.id,
          role: 'user',
          content,
          evidence: [],
          createdAt: userMessage.createdAt ?? new Date().toISOString()
        }]
      } : current);
    }
    setDraft('');
    setIsBusy(true);
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    abortRef.current = controller;
    const requestIdentity = identity;

    try {
      let consultation = activeConsultation;
      if (consultationMode === 'available' && !consultation) {
        setIsConsultationDetailLoading(true);
        consultation = await createBusinessHermesConsultation(controller.signal);
        if (controller.signal.aborted || requestId !== requestIdRef.current || identityRef.current !== requestIdentity) return;
        setActiveConsultation({ ...consultation, messages: [...consultation.messages, {
          id: userMessage.id,
          role: 'user',
          content,
          evidence: [],
          createdAt: userMessage.createdAt ?? new Date().toISOString()
        }] });
        replaceConsultationInList(consultation);
        setIsConsultationDetailLoading(false);
      }
      const response: BusinessHermesChatResponse | BusinessHermesConsultationChatResponse = consultationMode === 'available' && consultation
        ? await sendBusinessHermesConsultationMessage({ consultationId: consultation.id, message: content }, controller.signal)
        : await sendBusinessHermesChat({ scope: 'both', messages: history }, controller.signal);
      const identityChanged = identityRef.current !== requestIdentity || getResolvedClientKey() !== clientKey;
      if (identityChanged) resetConversation({ clearConsultations: true });
      if (controller.signal.aborted || requestId !== requestIdRef.current || identityChanged) return;
      const consultationResponse: BusinessHermesConsultationChatResponse | null = 'consultationId' in response
        ? response as BusinessHermesConsultationChatResponse
        : null;
      if (consultationResponse?.consultation && isConsultationDetail(consultationResponse.consultation)) {
        const nextConsultation = consultationResponse.consultation;
        setActiveConsultation(nextConsultation);
        setMessages(messagesFromConsultation(nextConsultation));
        const confirmation = consultationResponse.confirmation;
        setConsultationSuggestion(confirmation ? {
          prompt: confirmation.prompt,
          options: confirmation.options,
          title: confirmation.title,
          relatedIdentifiers: confirmation.relatedIdentifiers ?? []
        } : null);
        replaceConsultationInList(nextConsultation);
      } else {
        if (consultationResponse?.consultation) {
          replaceConsultationInList(consultationResponse.consultation);
          setActiveConsultation((current) => current && current.id === consultationResponse.consultation?.id
            ? { ...current, ...consultationResponse.consultation }
            : current);
        }
        const assistantContent = responseText(response);
        if (assistantContent) {
          const assistantMessage: HermesPanelMessage = {
            id: `hermes-assistant-${requestId}`,
            role: 'assistant',
            content: assistantContent,
            evidence: evidenceForMessage(response.evidence),
            evidenceVisible: 'evidenceVisible' in response ? response.evidenceVisible : undefined,
            createdAt: new Date().toISOString()
          };
          setMessages((current) => [...current, assistantMessage]);
          if (activeConsultation) {
            setActiveConsultation((current) => current ? {
              ...current,
              messages: [...current.messages, {
                id: assistantMessage.id,
                role: assistantMessage.role,
                content: assistantMessage.content,
                evidence: assistantMessage.evidence ? [...assistantMessage.evidence] : [],
                evidenceVisible: assistantMessage.evidenceVisible,
                createdAt: assistantMessage.createdAt ?? new Date().toISOString()
              }]
            } : current);
          }
        }
      }
      if (response.status === 'unavailable') {
        setError(response.evidence.length > 0
          ? '回答生成が利用できないため、根拠カードのみ表示しています。'
          : response.reasonCode === 'HERMES_NOT_CONFIGURED'
            ? 'Hermesの能力設定が未有効です。管理者の設定後に再試行してください。'
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
        setIsConsultationDetailLoading(false);
      }
    }
  }, [activeConsultation, clientKey, consultationMode, draft, ensureCurrentClientKey, identity, isBusy, messages, replaceConsultationInList, resetConversation]);

  const respondToSuggestion = useCallback((answer: string) => {
    if (!activeConsultation || !consultationSuggestion || isBusy) return;
    const prompt = consultationSuggestion.prompt.trim();
    const message = `「${prompt}」への回答は「${answer}」です。`;
    void sendMessage(message);
  }, [activeConsultation, consultationSuggestion, isBusy, sendMessage]);

  const closePanel = useCallback(() => {
    setOpen(false);
    iconRef.current?.focus();
  }, []);

  const togglePanelSize = useCallback(() => {
    setIsPanelExpanded((current) => !current);
  }, []);

  const panelScale = isPanelExpanded ? 2 : 1;
  const panelWidth = isPanelExpanded
    ? Math.min(PANEL_STANDARD_WIDTH * panelScale, Math.max(1, viewport.width - VIEWPORT_GUTTER * 2))
    : Math.min(PANEL_STANDARD_WIDTH, Math.max(280, viewport.width - VIEWPORT_GUTTER * 2));
  const spaceAboveIcon = Math.max(180, position.top - VIEWPORT_GUTTER * 2);
  const spaceBelowIcon = Math.max(180, viewport.height - position.top - ICON_SIZE - VIEWPORT_GUTTER * 2);
  const opensAbove = position.top > viewport.height / 2 || spaceAboveIcon >= spaceBelowIcon;
  const panelHeight = isPanelExpanded
    ? Math.min(PANEL_STANDARD_HEIGHT * panelScale, Math.max(1, viewport.height - VIEWPORT_GUTTER * 2))
    : Math.min(
      PANEL_STANDARD_HEIGHT,
      Math.max(180, viewport.height - VIEWPORT_GUTTER * 2),
      opensAbove ? spaceAboveIcon : spaceBelowIcon
    );
  const panelLeft = Math.min(
    Math.max(VIEWPORT_GUTTER, position.left + ICON_SIZE / 2 - panelWidth / 2),
    Math.max(VIEWPORT_GUTTER, viewport.width - panelWidth - VIEWPORT_GUTTER)
  );
  const panelTop = isPanelExpanded
    ? (() => {
      const preferredPanelTop = opensAbove
        ? position.top - panelHeight - 12
        : position.top + ICON_SIZE + 12;
      return Math.min(
        Math.max(VIEWPORT_GUTTER, preferredPanelTop),
        Math.max(VIEWPORT_GUTTER, viewport.height - panelHeight - VIEWPORT_GUTTER)
      );
    })()
    : opensAbove
      ? Math.max(VIEWPORT_GUTTER, position.top - panelHeight - 12)
      : Math.min(position.top + ICON_SIZE + 12, Math.max(VIEWPORT_GUTTER, viewport.height - panelHeight - VIEWPORT_GUTTER));
  const panelStyle = {
    left: panelLeft,
    top: panelTop,
    width: panelWidth,
    height: panelHeight,
    maxHeight: panelHeight
  };
  const iconStyle = { left: position.left, top: position.top };
  const panelProps: HermesChatPanelProps = {
    mode: consultationMode === 'legacy' ? 'legacy' : 'consultations',
    messages,
    draft,
    isBusy,
    error,
    authRequired,
    consultations,
    activeConsultation,
    isConsultationsLoading,
    isConsultationDetailLoading,
    isMessageHistoryLoading,
    messageHistoryError,
    consultationError,
    onDraftChange: setDraft,
    onSend: sendMessage,
    onReset: resetActiveConversation,
    onClose: closePanel,
    onStop: stopRequest,
    isExpanded: isPanelExpanded,
    onToggleSize: togglePanelSize,
    onNewConsultation: createConsultation,
    onSelectConsultation: (consultationId) => void selectConsultation(consultationId),
    onLoadOlderMessages: () => void loadOlderMessages(),
    suggestion: consultationSuggestion,
    onAnswerSuggestion: respondToSuggestion
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
