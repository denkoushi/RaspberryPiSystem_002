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

// HTTPSページの場合は自動的にWSSに変換（Caddy経由）
const getAgentWsUrl = () => {
  const envUrl = import.meta.env.VITE_AGENT_WS_URL ?? 'ws://localhost:7071/stream';
  if (isBrowser && window.location.protocol === 'https:') {
    return `wss://${window.location.host}/stream`;
  }
  return envUrl;
};

const AGENT_WS_URL = getAgentWsUrl();

export function useNfcStream() {
  const [event, setEvent] = useState<NfcEvent | null>(null);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout>>();
  const lastEventKeyRef = useRef<string | null>(null); // 最後に処理したイベントのキー
  const lastProcessedEventIdRef = useRef<number | null>(null);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let isMounted = true;

    if (lastProcessedEventIdRef.current === null) {
      lastProcessedEventIdRef.current = readStoredEventId();
    }

    const connect = () => {
      if (!isMounted) return;
      
      try {
        socket = new WebSocket(AGENT_WS_URL);
        socket.onmessage = (message) => {
          if (!isMounted) return;
          try {
            const payload = JSON.parse(message.data) as NfcEvent;
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
          // エラーをコンソールに出力しない（WebSocket接続エラーは正常な動作の一部）
          reconnectTimeout.current = setTimeout(connect, 2000);
        };
        socket.onerror = (error) => {
          // エラーをコンソールに出力しない（WebSocket接続エラーは正常な動作の一部）
          // 接続が失敗した場合は、oncloseが呼ばれるので、そこで再接続する
        };
      } catch (error) {
        // 接続エラーは無視（NFCエージェントが起動していない場合など）
        if (isMounted) {
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
    };
  }, []);

  return event;
}
