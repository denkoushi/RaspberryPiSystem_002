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

  const connect = useCallback(() => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTCSignaling.ts:78',message:'connect called',data:{enabled,hasWindow:typeof window !== 'undefined'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    if (!enabled || typeof window === 'undefined') {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTCSignaling.ts:81',message:'connect early return',data:{enabled,hasWindow:typeof window !== 'undefined'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      return;
    }

    const clientKey = resolveClientKey();
    const clientId = resolveClientId();
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTCSignaling.ts:87',message:'clientKey/clientId resolved',data:{hasClientKey:!!clientKey,hasClientId:!!clientId,clientKeyLength:clientKey?.length || 0,clientIdLength:clientId?.length || 0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion

    if (!clientKey || !clientId) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTCSignaling.ts:90',message:'clientKey or clientId missing',data:{hasClientKey:!!clientKey,hasClientId:!!clientId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      console.warn('WebRTC signaling: clientKey or clientId not found');
      return;
    }

    // 既に接続済みまたは接続試行中の場合は重複接続を防ぐ
    const currentState = socketRef.current?.readyState;
    if (currentState === WebSocket.OPEN || currentState === WebSocket.CONNECTING) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTCSignaling.ts:103',message:'connect skipped: already connected or connecting',data:{readyState:currentState},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      return;
    }

    setIsConnecting(true);

    try {
      // WebSocket URLを構築
      // HTTPSの場合はwss://、HTTPの場合はws://に自動変換
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/webrtc/signaling?clientKey=${encodeURIComponent(clientKey)}`;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTCSignaling.ts:102',message:'WebSocket URL constructed',data:{protocol,host:window.location.host,wsUrl,protocolFromWindow:window.location.protocol},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      const socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTCSignaling.ts:119',message:'WebSocket onopen',data:{readyState:socket.readyState,url:wsUrl},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
        setIsConnected(true);
        setIsConnecting(false);
        reconnectAttemptsRef.current = 0;
        console.log('WebRTC signaling connected');
      };

      socket.onmessage = (event) => {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTCSignaling.ts:onmessage',message:'WebSocket onmessage received',data:{eventDataLen:event.data?.length||0,eventDataPreview:String(event.data).slice(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run-msg',hypothesisId:'F1'})}).catch(()=>{});
        // #endregion
        try {
          const message: SignalingMessage = JSON.parse(event.data);
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTCSignaling.ts:onmessage:parsed',message:'message parsed',data:{type:message.type,callId:message.callId,from:message.from,to:message.to},timestamp:Date.now(),sessionId:'debug-session',runId:'run-msg',hypothesisId:'F1'})}).catch(()=>{});
          // #endregion

          switch (message.type) {
            case 'incoming': {
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTCSignaling.ts:case-incoming',message:'incoming case matched',data:{callId:message.callId,from:message.from,hasOnIncomingCall:typeof onIncomingCall === 'function'},timestamp:Date.now(),sessionId:'debug-session',runId:'run-msg',hypothesisId:'F2'})}).catch(()=>{});
              // #endregion
              // 着信通知
              if (message.callId && message.from) {
                const payload = message.payload as IncomingCallPayload | undefined;
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTCSignaling.ts:before-onIncomingCall',message:'about to call onIncomingCall',data:{callId:message.callId,from:message.from,payloadHas:!!payload},timestamp:Date.now(),sessionId:'debug-session',runId:'run-msg',hypothesisId:'F2'})}).catch(()=>{});
                // #endregion
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
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTCSignaling.ts:214',message:'WebSocket onerror',data:{readyState:socket.readyState,errorType:error?.type || 'unknown',errorTarget:error?.target ? 'present' : 'missing',url:wsUrl,protocol:protocol},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
        console.error('WebRTC signaling WebSocket error:', error);
        setIsConnected(false);
        setIsConnecting(false);
        // onErrorはrate-limitされているため、ここでは呼ばない（oncloseで呼ばれる）
      };

      socket.onclose = (event) => {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTCSignaling.ts:224',message:'WebSocket onclose',data:{code:event.code,reason:event.reason,wasClean:event.wasClean,reconnectAttempts:reconnectAttemptsRef.current,url:wsUrl},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
        setIsConnected(false);
        setIsConnecting(false);
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
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTCSignaling.ts:221',message:'WebSocket creation error',data:{errorMessage:error instanceof Error ? error.message : String(error),errorStack:error instanceof Error ? error.stack : undefined},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
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

