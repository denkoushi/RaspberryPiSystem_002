import { useEffect, useRef, useState } from 'react';

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
// - デフォルトは従来どおり: HTTPSページでは Caddy 経由の /stream を使う
// - localモードでは: ws://localhost:7071/stream を優先し、失敗時に従来経路へフォールバックする
const getAgentWsCandidates = (): string[] => {
  const envUrl = import.meta.env.VITE_AGENT_WS_URL ?? 'ws://localhost:7071/stream';
  const mode = String(import.meta.env.VITE_AGENT_WS_MODE ?? '').toLowerCase();
  const candidates: string[] = [];
  const add = (url: string | undefined) => {
    if (!url) return;
    if (candidates.includes(url)) return;
    candidates.push(url);
  };

  if (mode === 'local') {
    add('ws://localhost:7071/stream');
  }

  // HTTPSページの場合は自動的にWSSに変換（Caddy経由）
  if (isBrowser && window.location.protocol === 'https:') {
    add(`wss://${window.location.host}/stream`);
  }

  add(envUrl);
  return candidates;
};

export function useNfcStream(enabled = false) {
  const [event, setEvent] = useState<NfcEvent | null>(null);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout>>();
  const lastEventKeyRef = useRef<string | null>(null); // 最後に処理したイベントのキー
  const lastProcessedEventIdRef = useRef<number | null>(null);
  // enabled=trueになった時刻を記録し、それ以前のイベントを無視するためのref
  const enabledAtRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setEvent(null);
      // enabled=falseになったらenabledAtをリセット
      enabledAtRef.current = null;
      return;
    }

    // enabled=trueになった時刻を記録（ISO文字列で比較可能）
    const enabledAt = new Date().toISOString();
    enabledAtRef.current = enabledAt;

    const wsCandidates = getAgentWsCandidates();
    let socket: WebSocket | null = null;
    let isMounted = true;
    let candidateIdx = 0;

    if (lastProcessedEventIdRef.current === null) {
      lastProcessedEventIdRef.current = readStoredEventId();
    }

    const connect = () => {
      if (!isMounted) return;
      
      try {
        const url = wsCandidates[Math.min(candidateIdx, wsCandidates.length - 1)];
        let opened = false;
        socket = new WebSocket(url);
        socket.onopen = () => {
          opened = true;
        };
        socket.onmessage = (message) => {
          if (!isMounted) return;
          try {
            const payload = JSON.parse(message.data) as NfcEvent;

            // スコープ分離: enabled=trueになった時刻より前のイベントは無視
            // これにより、別ページから遷移してきた際に以前のイベントを拾わない
            if (enabledAtRef.current && payload.timestamp < enabledAtRef.current) {
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
              return;
            }
            lastEventKeyRef.current = eventKey;
            if (eventId !== null) {
              lastProcessedEventIdRef.current = eventId;
              persistEventId(eventId);
            }
            setEvent(payload);
          } catch {
            // ignore malformed payload
          }
        };
        socket.onclose = () => {
          if (!isMounted) return;

          // localモードでlocalhostへ接続できない環境（管理Mac等）では、
          // まず次の候補（通常は wss://<Pi5>/stream）へ即フォールバックする。
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
  }, [enabled]);

  return event;
}
