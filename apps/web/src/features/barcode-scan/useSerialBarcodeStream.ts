import { useEffect, useRef } from 'react';

export type BarcodeAgentStreamPayload = {
  type: string;
  text: string;
  timestamp?: string;
  eventId?: number;
};

const isBrowser = typeof window !== 'undefined';
const LAST_BARCODE_EVENT_ID_KEY = 'kiosk-last-barcode-event-id';

const readStoredEventId = () => {
  if (!isBrowser) return null;
  const raw = window.sessionStorage.getItem(LAST_BARCODE_EVENT_ID_KEY);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const persistEventId = (eventId: number) => {
  if (!isBrowser) return;
  window.sessionStorage.setItem(LAST_BARCODE_EVENT_ID_KEY, String(eventId));
};

const resolveWsUrl = (override?: string) =>
  override ?? import.meta.env.VITE_BARCODE_AGENT_WS_URL ?? 'ws://localhost:7072/stream';

/**
 * Pi4 barcode-agent（シリアルリーダー）からの localhost WebSocket を受け、スキャン文字列を返す。
 * HID の useKeyboardWedgeScan とは I/O 責務を分離する。
 */
export function useSerialBarcodeStream(
  enabled: boolean,
  onScan: (text: string) => void,
  /** テスト用。未指定時は VITE_BARCODE_AGENT_WS_URL または ws://localhost:7072/stream */
  wsUrl?: string
) {
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout>>();
  const lastProcessedEventIdRef = useRef<number | null>(null);
  const lastTextRef = useRef<string | null>(null);
  const enabledAtRef = useRef<string | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) {
      enabledAtRef.current = null;
      return;
    }

    const enabledAt = new Date().toISOString();
    enabledAtRef.current = enabledAt;

    const resolvedUrl = resolveWsUrl(wsUrl);

    if (lastProcessedEventIdRef.current === null) {
      lastProcessedEventIdRef.current = readStoredEventId();
    }

    let socket: WebSocket | null = null;
    let isMounted = true;

    const connect = () => {
      if (!isMounted) return;
      try {
        socket = new WebSocket(resolvedUrl);
        socket.onmessage = (message) => {
          if (!isMounted) return;
          try {
            const payload = JSON.parse(message.data) as BarcodeAgentStreamPayload;
            if (payload.type !== 'barcodeScan' || typeof payload.text !== 'string') {
              return;
            }
            if (enabledAtRef.current && payload.timestamp && payload.timestamp < enabledAtRef.current) {
              return;
            }
            const eventId = typeof payload.eventId === 'number' ? payload.eventId : null;
            if (eventId !== null) {
              const lastProcessed = lastProcessedEventIdRef.current ?? readStoredEventId();
              if (lastProcessed !== null && eventId <= lastProcessed) {
                return;
              }
            }
            const text = payload.text.trim();
            if (!text) return;
            if (eventId === null && lastTextRef.current === text) {
              return;
            }
            lastTextRef.current = text;
            if (eventId !== null) {
              lastProcessedEventIdRef.current = eventId;
              persistEventId(eventId);
            }
            onScanRef.current(text);
          } catch {
            // ignore malformed payload
          }
        };
        socket.onclose = () => {
          if (!isMounted) return;
          reconnectTimeout.current = setTimeout(connect, 2000);
        };
        socket.onerror = () => {
          // 再接続は onclose 側
        };
      } catch {
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
      lastTextRef.current = null;
    };
  }, [enabled, wsUrl]);
}
