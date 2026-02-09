/**
 * WebRTCシグナリング用WebSocketフック
 * 既存のuseNfcStreamとは独立した実装
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { DEFAULT_CLIENT_KEY } from '../../../api/client';
import { playRingtone } from '../utils/ringtone';

import type { IncomingCallPayload, SignalingMessage } from '../types';

const resolveClientKey = (): string => {
  if (typeof window === 'undefined') return DEFAULT_CLIENT_KEY;
  
  // Mac環境を検出（User-Agentから）
  const isMac = /Macintosh|Mac OS X/i.test(navigator.userAgent);
  const macDefaultKey = 'client-key-mac-kiosk1';
  
  const savedKey = window.localStorage.getItem('kiosk-client-key');
  if (!savedKey || savedKey.length === 0) {
    // localStorageが空の場合、Mac環境ならMac用のキーを返す
    return isMac ? macDefaultKey : DEFAULT_CLIENT_KEY;
  }
  
  let parsedKey: string | null = null;
  try {
    const parsed = JSON.parse(savedKey);
    if (typeof parsed === 'string' && parsed.length > 0) {
      parsedKey = parsed;
    }
  } catch {
    // JSON.parseに失敗した場合は生の値をそのまま使用
    parsedKey = savedKey;
  }
  
  const resolvedKey = parsedKey || savedKey || DEFAULT_CLIENT_KEY;
  
  // Mac環境でPi4のキーが設定されている場合、Mac用のキーに修正
  if (isMac && resolvedKey === 'client-key-raspberrypi4-kiosk1') {
    // localStorageを修正
    window.localStorage.setItem('kiosk-client-key', JSON.stringify(macDefaultKey));
    return macDefaultKey;
  }
  
  return resolvedKey;
};

const PONG_STALE_MS = 90_000;

export interface UseWebRTCSignalingOptions {
  enabled?: boolean;
  onIncomingCall?: (callId: string, from: string, payload?: IncomingCallPayload) => void;
  onCallAccepted?: (callId: string) => void;
  onCallRejected?: (callId: string) => void;
  onCallCancelled?: (callId: string) => void;
  onCallHangup?: (callId: string) => void;
  onOffer?: (message: SignalingMessage) => void;
  onAnswer?: (message: SignalingMessage) => void;
  onIceCandidate?: (message: SignalingMessage) => void;
  onError?: (error: Error) => void;
}

export function useWebRTCSignaling(options: UseWebRTCSignalingOptions = {}) {
  const {
    enabled = true,
    onIncomingCall,
    onCallAccepted,
    onCallRejected,
    onCallCancelled,
    onCallHangup,
    onOffer,
    onAnswer,
    onIceCandidate,
    onError
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isPlayingRingtoneRef = useRef(false);
  const connectionStartTimeRef = useRef<number | null>(null);
  const keepaliveIntervalRef = useRef<number | null>(null);
  const lastPongAtRef = useRef<number | null>(null);

  const connect = useCallback(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }

    // #region agent log
    try {
      const rawKey = window.localStorage.getItem('kiosk-client-key');
      const rawId = window.localStorage.getItem('kiosk-client-id');
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTCSignaling.ts:connect:entry',message:'signaling_connect_entry',data:{enabled,readyState:socketRef.current?.readyState ?? null,online:typeof navigator!=='undefined'?navigator.onLine:null,visibility:typeof document!=='undefined'?document.visibilityState:null,hasStoredKey:Boolean(rawKey&&rawKey.length>0),hasStoredId:Boolean(rawId&&rawId.length>0),reconnectAttempts:reconnectAttemptsRef.current},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    } catch {
      // デバッグログの失敗は無視（本処理を止めない）
    }
    // #endregion

    const clientKey = resolveClientKey();
    if (!clientKey) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTCSignaling.ts:connect:missing',message:'signaling_connect_missing_key',data:{hasClientKey:Boolean(clientKey&&clientKey.length>0),readyState:socketRef.current?.readyState ?? null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      console.warn('WebRTC signaling: clientKey not found');
      return;
    }

    // 既に接続済みまたは接続試行中の場合は重複接続を防ぐ
    const currentState = socketRef.current?.readyState;
    if (currentState === WebSocket.OPEN || currentState === WebSocket.CONNECTING) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTCSignaling.ts:connect:skip',message:'signaling_connect_skipped_due_to_state',data:{readyState:currentState,online:typeof navigator!=='undefined'?navigator.onLine:null,visibility:typeof document!=='undefined'?document.visibilityState:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      return;
    }

    setIsConnecting(true);

    try {
      // WebSocket URLを構築
      // HTTPSの場合はwss://、HTTPの場合はws://に自動変換
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/webrtc/signaling?clientKey=${encodeURIComponent(clientKey)}`;
      const socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        setIsConnected(true);
        setIsConnecting(false);
        reconnectAttemptsRef.current = 0;
        connectionStartTimeRef.current = Date.now();
        lastPongAtRef.current = Date.now();
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTCSignaling.ts:socket:onopen',message:'signaling_socket_open',data:{online:typeof navigator!=='undefined'?navigator.onLine:null,visibility:typeof document!=='undefined'?document.visibilityState:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        console.log('WebRTC signaling connected');
        // Keepalive: 30秒ごとにpingメッセージを送信（5分タイムアウトを防ぐ）
        keepaliveIntervalRef.current = window.setInterval(() => {
          if (socketRef.current?.readyState === WebSocket.OPEN) {
            try {
              socketRef.current.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
            } catch (error) {
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTCSignaling.ts:keepalive:send',message:'signaling_keepalive_send_failed',data:{readyState:socketRef.current?.readyState ?? null,online:typeof navigator!=='undefined'?navigator.onLine:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
              // #endregion
              console.error('Failed to send keepalive ping:', error);
            }
          }
        }, 30000); // 30秒
      };

      socket.onmessage = (event) => {
        try {
          const message: SignalingMessage = JSON.parse(event.data);

          switch (message.type) {
            case 'incoming': {
              // 着信通知
              if (message.callId && message.from) {
                const payload = message.payload as IncomingCallPayload | undefined;
                onIncomingCall?.(message.callId, message.from, payload);

                // 呼び出し音を再生（重複再生を防ぐ）
                if (!isPlayingRingtoneRef.current) {
                  isPlayingRingtoneRef.current = true;
                  playRingtone().finally(() => {
                    isPlayingRingtoneRef.current = false;
                  });
                }
              }
              break;
            }

            case 'accept': {
              // 受話通知
              if (message.callId) {
                onCallAccepted?.(message.callId);
              }
              break;
            }

            case 'reject': {
              // 拒否通知
              if (message.callId) {
                onCallRejected?.(message.callId);
              }
              break;
            }

            case 'cancel': {
              // キャンセル通知
              if (message.callId) {
                onCallCancelled?.(message.callId);
              }
              break;
            }

            case 'hangup': {
              // 切断通知
              if (message.callId) {
                onCallHangup?.(message.callId);
              }
              break;
            }

            case 'offer': {
              onOffer?.(message);
              break;
            }

            case 'answer': {
              onAnswer?.(message);
              break;
            }

            case 'ice-candidate': {
              onIceCandidate?.(message);
              break;
            }

            case 'pong': {
              // Keepalive pong応答
              lastPongAtRef.current = Date.now();
              break;
            }

            case 'error': {
              const errorPayload = message.payload as { message?: string } | undefined;
              const error = new Error(errorPayload?.message || 'WebRTC signaling error');
              onError?.(error);
              break;
            }

            default:
              break;
          }
        } catch (error) {
          console.error('Failed to parse signaling message:', error);
          onError?.(error instanceof Error ? error : new Error('Failed to parse signaling message'));
        }
      };

      socket.onerror = (error) => {
        console.error('WebRTC signaling WebSocket error:', error);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTCSignaling.ts:socket:onerror',message:'signaling_socket_error',data:{readyState:socketRef.current?.readyState ?? null,online:typeof navigator!=='undefined'?navigator.onLine:null,visibility:typeof document!=='undefined'?document.visibilityState:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        setIsConnected(false);
        setIsConnecting(false);
        // onErrorはrate-limitされているため、ここでは呼ばない（oncloseで呼ばれる）
      };

      socket.onclose = (event) => {
        setIsConnected(false);
        setIsConnecting(false);
        connectionStartTimeRef.current = null;
        lastPongAtRef.current = null;
        
        // Keepalive intervalをクリア
        if (keepaliveIntervalRef.current) {
          clearInterval(keepaliveIntervalRef.current);
          keepaliveIntervalRef.current = null;
        }
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTCSignaling.ts:socket:onclose',message:'signaling_socket_close',data:{code:event.code,wasClean:event.wasClean,hadKeepalive:Boolean(keepaliveIntervalRef.current),online:typeof navigator!=='undefined'?navigator.onLine:null,visibility:typeof document!=='undefined'?document.visibilityState:null,reconnectAttempts:reconnectAttemptsRef.current},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        console.log('WebRTC signaling disconnected');
        // 異常終了（code 1006）の場合はエラーを通知
        if (event.code === 1006 && !event.wasClean) {
          onError?.(new Error(`WebSocket connection closed abnormally (code: ${event.code})`));
        }

        // 再接続（最大10回、指数バックオフ）
        if (enabled && reconnectAttemptsRef.current < 10) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          reconnectAttemptsRef.current++;
          reconnectTimeoutRef.current = window.setTimeout(() => {
            connect();
          }, delay);
        }
      };

      socketRef.current = socket;
    } catch (error) {
      setIsConnecting(false);
      onError?.(error instanceof Error ? error : new Error('Failed to create WebSocket'));
    }
  }, [enabled, onIncomingCall, onCallAccepted, onCallRejected, onCallCancelled, onCallHangup, onOffer, onAnswer, onIceCandidate, onError]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (keepaliveIntervalRef.current) {
      clearInterval(keepaliveIntervalRef.current);
      keepaliveIntervalRef.current = null;
    }
    reconnectAttemptsRef.current = 0;

    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    lastPongAtRef.current = null;
    setIsConnected(false);
    setIsConnecting(false);
  }, []);

  const isConnectionStale = useCallback(() => {
    const socketState = socketRef.current?.readyState;
    if (socketState === WebSocket.CONNECTING) return false;
    if (socketState !== WebSocket.OPEN) return true;
    const lastPongAt = lastPongAtRef.current;
    if (!lastPongAt) return true;
    return Date.now() - lastPongAt > PONG_STALE_MS;
  }, []);

  const reconnectIfNeeded = useCallback(() => {
    if (!enabled) return;
    if (!isConnectionStale()) return;
    disconnect();
    connect();
  }, [connect, disconnect, enabled, isConnectionStale]);

  const sendMessage = useCallback((message: SignalingMessage) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      try {
        socketRef.current.send(JSON.stringify(message));
      } catch (error) {
        setIsConnected(false);
        onError?.(error instanceof Error ? error : new Error('WebSocket send failed'));
        reconnectIfNeeded();
      }
    } else {
      console.warn('WebRTC signaling: socket not connected');
      onError?.(new Error('WebSocket not connected'));
      reconnectIfNeeded();
    }
  }, [onError, reconnectIfNeeded]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        reconnectIfNeeded();
      }
    };
    const handleOnline = () => {
      reconnectIfNeeded();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, [enabled, reconnectIfNeeded]);

  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]); // connect/disconnectは依存配列から除外（再作成による無限ループを防ぐ）

  return {
    isConnected,
    isConnecting,
    sendMessage,
    connect,
    disconnect
  };
}

