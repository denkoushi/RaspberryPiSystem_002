import { useEffect, useRef, useState } from 'react';

import { getNfcWsCandidates } from '../features/nfc/nfcEventSource';
import { resolveNfcStreamPolicy, type NfcStreamPolicy } from '../features/nfc/nfcPolicy';

export interface NfcEvent {
  uid: string;
  timestamp: string;
  readerSerial?: string;
  type?: string;
  eventId?: number;
}

const isBrowser = typeof window !== 'undefined';
const LAST_EVENT_ID_KEY = 'kiosk-last-event-id';

const readStoredEventId = () => {
  if (!isBrowser) return null;
  const raw = window.sessionStorage.getItem(LAST_EVENT_ID_KEY);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const persistEventId = (eventId: number) => {
  if (!isBrowser) return;
  window.sessionStorage.setItem(LAST_EVENT_ID_KEY, String(eventId));
};

// ViteのVITE_*はビルド時に埋め込まれる。
// - localOnlyポリシー: ws://localhost:7071/stream のみ（フォールバック無し）
// - legacyポリシー: 従来互換（HTTPSページでは host 経由の /stream も候補に入る）
export function useNfcStream(enabled = false, policy?: NfcStreamPolicy) {
  const [event, setEvent] = useState<NfcEvent | null>(null);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout>>();
  const lastEventKeyRef = useRef<string | null>(null); // 最後に処理したイベントのキー
  const lastProcessedEventIdRef = useRef<number | null>(null);
  // enabled=trueになった時刻を記録し、それ以前のイベントを無視するためのref
  const enabledAtRef = useRef<string | null>(null);

  useEffect(() => {
    const resolvedPolicy = policy ?? resolveNfcStreamPolicy();
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'00322f'},body:JSON.stringify({sessionId:'00322f',runId:'kensaku-main-nfc-pre',hypothesisId:'H1',location:'useNfcStream.ts:42',message:'nfc hook effect entered',data:{enabled,resolvedPolicy},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    if (!enabled || resolvedPolicy === 'disabled') {
      setEvent(null);
      // enabled=falseになったらenabledAtをリセット
      enabledAtRef.current = null;
      return;
    }

    // enabled=trueになった時刻を記録（ISO文字列で比較可能）
    const enabledAt = new Date().toISOString();
    enabledAtRef.current = enabledAt;

    const wsCandidates = getNfcWsCandidates({
      policy: resolvedPolicy,
      envUrl: import.meta.env.VITE_AGENT_WS_URL ?? 'ws://localhost:7071/stream',
      mode: String(import.meta.env.VITE_AGENT_WS_MODE ?? '').toLowerCase(),
      location: isBrowser ? { protocol: window.location.protocol, host: window.location.host } : undefined,
    });
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'00322f'},body:JSON.stringify({sessionId:'00322f',runId:'kensaku-main-nfc-pre',hypothesisId:'H2',location:'useNfcStream.ts:61',message:'nfc ws candidates resolved',data:{wsCandidates},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    let socket: WebSocket | null = null;
    let isMounted = true;
    let candidateIdx = 0;

    if (lastProcessedEventIdRef.current === null) {
      lastProcessedEventIdRef.current = readStoredEventId();
    }

    const connect = () => {
      if (!isMounted) return;
      if (wsCandidates.length === 0) return;
      
      try {
        const url = wsCandidates[Math.min(candidateIdx, wsCandidates.length - 1)];
        let opened = false;
        socket = new WebSocket(url);
        socket.onopen = () => {
          opened = true;
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'00322f'},body:JSON.stringify({sessionId:'00322f',runId:'kensaku-main-nfc-pre',hypothesisId:'H2',location:'useNfcStream.ts:82',message:'nfc websocket opened',data:{url,candidateIdx},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
        };
        socket.onmessage = (message) => {
          if (!isMounted) return;
          try {
            const payload = JSON.parse(message.data) as NfcEvent;
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'00322f'},body:JSON.stringify({sessionId:'00322f',runId:'kensaku-main-nfc-pre',hypothesisId:'H3',location:'useNfcStream.ts:90',message:'nfc websocket message received',data:{uid:payload.uid,timestamp:payload.timestamp,eventId:payload.eventId ?? null},timestamp:Date.now()})}).catch(()=>{});
            // #endregion

            // スコープ分離: enabled=trueになった時刻より前のイベントは無視
            // これにより、別ページから遷移してきた際に以前のイベントを拾わない
            if (enabledAtRef.current && payload.timestamp < enabledAtRef.current) {
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'00322f'},body:JSON.stringify({sessionId:'00322f',runId:'kensaku-main-nfc-pre',hypothesisId:'H3',location:'useNfcStream.ts:95',message:'nfc event dropped by enabledAt guard',data:{uid:payload.uid,payloadTs:payload.timestamp,enabledAt:enabledAtRef.current},timestamp:Date.now()})}).catch(()=>{});
              // #endregion
              return;
            }

            const eventId = typeof payload.eventId === 'number' ? payload.eventId : null;
            if (eventId !== null) {
              const lastProcessed = lastProcessedEventIdRef.current ?? readStoredEventId();
              if (lastProcessed !== null && eventId <= lastProcessed) {
                return;
              }
            }
            // 同じイベント（uid + timestamp）を複数回発火しないようにする（eventIdが無い場合のフォールバック）
            const eventKey = `${payload.uid}:${payload.timestamp}`;
            if (eventId === null && lastEventKeyRef.current === eventKey) {
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'00322f'},body:JSON.stringify({sessionId:'00322f',runId:'kensaku-main-nfc-pre',hypothesisId:'H3',location:'useNfcStream.ts:109',message:'nfc event dropped by duplicate key guard',data:{eventKey},timestamp:Date.now()})}).catch(()=>{});
              // #endregion
              return;
            }
            lastEventKeyRef.current = eventKey;
            if (eventId !== null) {
              lastProcessedEventIdRef.current = eventId;
              persistEventId(eventId);
            }
            setEvent(payload);
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'00322f'},body:JSON.stringify({sessionId:'00322f',runId:'kensaku-main-nfc-pre',hypothesisId:'H4',location:'useNfcStream.ts:117',message:'nfc event accepted into hook state',data:{uid:payload.uid,eventId:payload.eventId ?? null},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
          } catch {
            // ignore malformed payload
          }
        };
        socket.onclose = () => {
          if (!isMounted) return;

          // legacy互換: localhostへ接続できない場合は、次の候補へ即フォールバックする。
          if (!opened && candidateIdx < wsCandidates.length - 1) {
            candidateIdx += 1;
            reconnectTimeout.current = setTimeout(connect, 100);
            return;
          }

          // エラーをコンソールに出力しない（WebSocket接続エラーは正常な動作の一部）
          reconnectTimeout.current = setTimeout(connect, 2000);
        };
        socket.onerror = (_error) => {
          // エラーをコンソールに出力しない（WebSocket接続エラーは正常な動作の一部）
          // 接続が失敗した場合は、oncloseが呼ばれるので、そこで再接続する
        };
      } catch (error) {
        // 接続エラーは無視（NFCエージェントが起動していない場合など）
        if (isMounted) {
          if (candidateIdx < wsCandidates.length - 1) {
            candidateIdx += 1;
            reconnectTimeout.current = setTimeout(connect, 100);
            return;
          }
          reconnectTimeout.current = setTimeout(connect, 2000);
        }
      }
    };

    connect();

    return () => {
      isMounted = false;
      socket?.close();
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
      }
      // クリーンアップ時にイベントキーをリセット（再接続時に新しいイベントを受け付けるため）
      lastEventKeyRef.current = null;
      setEvent(null);
    };
  }, [enabled, policy]);

  return event;
}
