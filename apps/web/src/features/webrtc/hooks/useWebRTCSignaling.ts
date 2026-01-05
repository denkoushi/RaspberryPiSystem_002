/**
 * WebRTCシグナリング用WebSocketフック
 * 既存のuseNfcStreamとは独立した実装
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { playRingtone } from '../utils/ringtone';

import type { IncomingCallPayload, SignalingMessage } from '../types';

const resolveClientKey = (): string => {
  if (typeof window === 'undefined') return '';
  const savedKey = window.localStorage.getItem('kiosk-client-key');
  if (!savedKey || savedKey.length === 0) return '';
  
  try {
    const parsed = JSON.parse(savedKey);
    if (typeof parsed === 'string' && parsed.length > 0) {
      return parsed;
    }
  } catch {
    // JSON.parseに失敗した場合は生の値をそのまま使用
  }
  return savedKey || '';
};

const resolveClientId = (): string | null => {
  if (typeof window === 'undefined') return null;
  const savedId = window.localStorage.getItem('kiosk-client-id');
  if (!savedId || savedId.length === 0) return null;
  
  try {
    const parsed = JSON.parse(savedId);
    if (typeof parsed === 'string' && parsed.length > 0) {
      return parsed;
    }
  } catch {
    // JSON.parseに失敗した場合は生の値をそのまま使用
  }
  return savedId || null;
};

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

  const connect = useCallback(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }

    const clientKey = resolveClientKey();
    const clientId = resolveClientId();

    if (!clientKey || !clientId) {
      console.warn('WebRTC signaling: clientKey or clientId not found');
      return;
    }

    // 既に接続済みまたは接続試行中の場合は重複接続を防ぐ
    const currentState = socketRef.current?.readyState;
    if (currentState === WebSocket.OPEN || currentState === WebSocket.CONNECTING) {
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
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTCSignaling.ts:onopen',message:'WebSocket connected',data:{timestamp:connectionStartTimeRef.current},timestamp:Date.now(),sessionId:'debug-session',runId:'run-timeout',hypothesisId:'H1'})}).catch(()=>{});
        // #endregion
        console.log('WebRTC signaling connected');
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
        setIsConnected(false);
        setIsConnecting(false);
        // onErrorはrate-limitされているため、ここでは呼ばない（oncloseで呼ばれる）
      };

      socket.onclose = (event) => {
        setIsConnected(false);
        setIsConnecting(false);
        const disconnectTime = Date.now();
        const connectionDuration = connectionStartTimeRef.current ? disconnectTime - connectionStartTimeRef.current : null;
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTCSignaling.ts:onclose',message:'WebSocket disconnected',data:{code:event.code,wasClean:event.wasClean,reason:event.reason,connectionDuration,connectionStartTime:connectionStartTimeRef.current,disconnectTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run-timeout',hypothesisId:'H1'})}).catch(()=>{});
        // #endregion
        connectionStartTimeRef.current = null;
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
    reconnectAttemptsRef.current = 0;

    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
  }, []);

  const sendMessage = useCallback((message: SignalingMessage) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    } else {
      console.warn('WebRTC signaling: socket not connected');
      onError?.(new Error('WebSocket not connected'));
    }
  }, [onError]);

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

