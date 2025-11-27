import { useEffect, useRef, useState } from 'react';

export interface NfcEvent {
  uid: string;
  timestamp: string;
  readerSerial?: string;
  type?: string;
}

const AGENT_WS_URL = import.meta.env.VITE_AGENT_WS_URL ?? 'ws://localhost:7071/stream';

export function useNfcStream() {
  const [event, setEvent] = useState<NfcEvent | null>(null);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    let socket: WebSocket | null = null;
    let isMounted = true;

    const connect = () => {
      if (!isMounted) return;
      
      try {
        socket = new WebSocket(AGENT_WS_URL);
        socket.onmessage = (message) => {
          if (!isMounted) return;
          try {
            const payload = JSON.parse(message.data) as NfcEvent;
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
    };
  }, []);

  return event;
}
