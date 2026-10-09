import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { listKioskInquiries } from '../../../api/client';
import { useKioskInquiries, useKioskInquiryActions } from '../../../api/hooks/kiosk';
import { Button } from '../../../components/ui/Button';
import { useArmedNfcRead } from '../inventory/setup/useArmedNfcRead';

import { inquiryErrorMessage, isInquiryAccessError } from './inquiryErrors';

import type { KioskInquiryDetail } from '../../../api/domains/kiosk';
import type { KioskInquiryAccess } from '../../../api/hooks/kiosk';

import './kiosk-inquiry.css';

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    .format(new Date(value));
}

export function KioskInquiryInbox({ clientKey, isReceiver }: { clientKey: string; isReceiver: boolean }) {
  const queryClient = useQueryClient();
  const [sessionId] = useState(() => crypto.randomUUID());
  const access = useRef<KioskInquiryAccess>({ active: false });
  const [unlocked, setUnlocked] = useState(!isReceiver);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<KioskInquiryDetail | null>(null);
  const [draft, setDraft] = useState('');
  const list = useKioskInquiries(clientKey, sessionId, access.current, unlocked);
  const actions = useKioskInquiryActions(clientKey, sessionId, access.current);
  const read = useArmedNfcRead(isReceiver && !unlocked && !verifying);
  const messagesRef = useRef<HTMLDivElement>(null);
  const busy = actions.open.isPending || actions.reply.isPending;

  useEffect(() => {
    const controller = new AbortController();
    const session = access.current;
    session.active = true;
    session.signal = controller.signal;
    return () => {
      session.active = false;
      session.employeeTagUid = undefined;
      controller.abort();
      const queryKey = ['kiosk-inquiries', clientKey, sessionId];
      void queryClient.cancelQueries({ queryKey });
      queryClient.removeQueries({ queryKey });
    };
  }, [clientKey, queryClient, sessionId]);

  useEffect(() => {
    if (!read?.uid) return;
    const controllerSignal = access.current.signal;
    setVerifying(true);
    setError(null);
    void listKioskInquiries(read.uid, controllerSignal).then(result => {
      if (controllerSignal?.aborted) return;
      access.current.employeeTagUid = read.uid;
      queryClient.setQueryData(['kiosk-inquiries', clientKey, sessionId], result);
      setUnlocked(true);
    }).catch(failure => {
      if (!controllerSignal?.aborted) setError(inquiryErrorMessage(failure, '社員証を確認できません'));
    }).finally(() => {
      if (!controllerSignal?.aborted) setVerifying(false);
    });
  }, [read, clientKey, queryClient, sessionId]);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [detail]);

  const handleFailure = useCallback((failure: unknown, fallback: string) => {
    if (!access.current.active) return;
    if (isReceiver && isInquiryAccessError(failure)) {
      access.current.employeeTagUid = undefined;
      setUnlocked(false);
      setDetail(null);
      setDraft('');
      queryClient.removeQueries({ queryKey: ['kiosk-inquiries', clientKey, sessionId] });
    }
    setError(inquiryErrorMessage(failure, fallback));
  }, [clientKey, isReceiver, queryClient, sessionId]);

  useEffect(() => {
    if (list.error) handleFailure(list.error, '一覧を取得できません');
  }, [list.error, handleFailure]);

  const openThread = async (threadId: string) => {
    if (busy) return;
    setError(null);
    try {
      const result = await actions.open.mutateAsync(threadId);
      if (access.current.active) { setDetail(result); setDraft(''); }
    } catch (failure) { handleFailure(failure, 'お問い合わせを開けません'); }
  };

  const send = async (body: string) => {
    const text = body.trim();
    if (!detail || !text || text.length > 500 || busy) return;
    setError(null);
    try {
      const result = await actions.reply.mutateAsync({ threadId: detail.thread.id, body: text });
      if (access.current.active) { setDetail(result); setDraft(''); }
    } catch (failure) { handleFailure(failure, '返信を送信できません'); }
  };

  if (!unlocked) return (
    <div className="kiosk-inquiry__lock" aria-busy={verifying}>
      <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" aria-hidden="true">
        <rect x="8" y="16" width="34" height="32" rx="5" />
        <path d="M16 26h12M16 34h18M48 22c5 6 5 14 0 20M54 16c8 10 8 22 0 32" />
      </svg>
      <p>社員証をタッチ</p>
      {error ? <p className="kiosk-inquiry__error" role="alert">{error}</p> : null}
    </div>
  );

  if (detail) return (
    <div className="kiosk-inquiry" aria-busy={busy}>
      <div className="kiosk-inquiry__thread-header">
        <Button type="button" variant="ghostOnDark" aria-label="一覧へ戻る" disabled={busy}
          onClick={() => { setDetail(null); setDraft(''); setError(null); }}>‹</Button>
        {isReceiver ? <div className="kiosk-inquiry__who">{detail.thread.senderClientDeviceName}
          <small>{detail.thread.senderLocation}</small></div> : null}
      </div>
      <div className="kiosk-inquiry__messages" ref={messagesRef}>
        {detail.messages.map(message => (
          <div key={message.id} className={`kiosk-inquiry__message${message.side === (isReceiver ? 'RECEIVER' : 'SENDER') ? ' kiosk-inquiry__message--mine' : ''}`}>
            {message.body}<time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
          </div>
        ))}
      </div>
      <div className="kiosk-inquiry__compose">
        <div className="kiosk-inquiry__quick">
          {(isReceiver ? ['行きます', '了解しました', 'あとで連絡します'] : ['了解です', 'お願いします']).map(text => (
            <Button key={text} type="button" variant="ghostOnDark" disabled={busy} onClick={() => void send(text)}>{text}</Button>
          ))}
        </div>
        <form className="kiosk-inquiry__send" onSubmit={event => { event.preventDefault(); void send(draft); }}>
          <input type="text" aria-label="返信" placeholder="返信" maxLength={500} value={draft} disabled={busy}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }} />
          <Button type="submit" aria-label="送信" disabled={busy || !draft.trim()}>➤</Button>
        </form>
        {error ? <p className="kiosk-inquiry__error" role="alert">{error}</p> : null}
      </div>
    </div>
  );

  return (
    <div className="kiosk-inquiry" aria-busy={list.isFetching || busy}>
      {error ? <p className="kiosk-inquiry__error" role="alert">{error}</p> : null}
      {list.isPending ? <p className="kiosk-inquiry__empty" role="status">読込中…</p> : null}
      {list.data?.threads.length === 0 ? <p className="kiosk-inquiry__empty">お問い合わせはありません</p> : null}
      <ul className="kiosk-inquiry__list">
        {list.data?.threads.map(thread => (
          <li key={thread.id}>
            <button type="button" className={`kiosk-inquiry__row${thread.unread ? ' kiosk-inquiry__row--unread' : ''}`}
              disabled={busy} onClick={() => void openThread(thread.id)}>
              <span className="kiosk-inquiry__mark" aria-label={thread.unread ? '未読' : undefined} />
              <span className="kiosk-inquiry__who">{isReceiver ? thread.senderClientDeviceName : thread.lastMessage?.body}</span>
              <time dateTime={thread.lastMessageAt}>{formatTime(thread.lastMessageAt)}</time>
              {isReceiver ? <><span className="kiosk-inquiry__location">{thread.senderLocation}</span>
                <span className="kiosk-inquiry__preview">{thread.lastMessage?.body}</span></> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
