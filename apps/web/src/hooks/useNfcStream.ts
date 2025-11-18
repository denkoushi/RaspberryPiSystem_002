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

    const connect = () => {
      socket = new WebSocket(AGENT_WS_URL);
      socket.onmessage = (message) => {
        try {
          const payload = JSON.parse(message.data) as NfcEvent;
          setEvent(payload);
        } catch {
          // ignore malformed payload
        }
      };
      socket.onclose = () => {
        reconnectTimeout.current = setTimeout(connect, 2000);
      };
      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      socket?.close();
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
      }
    };
  }, []);

  return event;
}
