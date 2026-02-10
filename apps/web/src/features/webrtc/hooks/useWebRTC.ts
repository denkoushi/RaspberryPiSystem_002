/**
 * WebRTCメインフック
 * RTCPeerConnectionを管理し、音声のみで開始→ビデオ追加に対応
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getAudioStream, getAudioVideoStream, getVideoStream } from '../utils/media';

import { useWebRTCSignaling } from './useWebRTCSignaling';

import type { SignalingMessage } from '../types';

export interface UseWebRTCOptions {
  enabled?: boolean;
  onLocalStream?: (stream: MediaStream | null) => void;
  onRemoteStream?: (stream: MediaStream | null) => void;
  onError?: (error: Error) => void;
}

export type CallState = 'idle' | 'ringing' | 'incoming' | 'connecting' | 'connected' | 'ended';

export function useWebRTC(options: UseWebRTCOptions = {}) {
  const { enabled = true, onLocalStream, onRemoteStream, onError } = options;

  const [callState, setCallState] = useState<CallState>('idle');
  const [currentCallId, setCurrentCallId] = useState<string | null>(null);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [incomingCallInfo, setIncomingCallInfo] = useState<{ callId: string; from: string; callerName?: string; callerLocation?: string | null } | null>(null);
  // UI反映用（MediaStreamはrefだけだと再描画されないためstateでも保持する）
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  // デバッグログ用：最新stateを参照するためのref（Hook依存関係の警告回避）
  const callStateRef = useRef<CallState>('idle');
  const currentCallIdRef = useRef<string | null>(null);
  const hasIncomingRef = useRef(false);
  
  // call関数のエラーハンドリング用：エラーレスポンスを待機するためのPromise
  const callErrorPromiseRef = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);

  // 外部コールバックはref化して、useCallback依存で関数同一性が変わらないようにする
  const onLocalStreamRef = useRef<UseWebRTCOptions['onLocalStream']>(onLocalStream);
  const onRemoteStreamRef = useRef<UseWebRTCOptions['onRemoteStream']>(onRemoteStream);
  const onErrorRef = useRef<UseWebRTCOptions['onError']>(onError);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const isNegotiatingRef = useRef(false);
  const videoSenderRef = useRef<RTCRtpSender | null>(null);
  const startCallRef = useRef<((callId: string, withVideo?: boolean) => Promise<void>) | null>(null);
  const pcConnectionStartTimeRef = useRef<number | null>(null);
  const pcIceConnectionStartTimeRef = useRef<number | null>(null);
  const disconnectedRestartTimerRef = useRef<number | null>(null);

  const toUiStream = useCallback((stream: MediaStream | null): MediaStream | null => {
    if (!stream) return null;
    // track追加/削除があってもReactの再描画が走るように、毎回新しいMediaStreamを作る
    return new MediaStream(stream.getTracks());
  }, []);

  useEffect(() => {
    onLocalStreamRef.current = onLocalStream;
    onRemoteStreamRef.current = onRemoteStream;
    onErrorRef.current = onError;
  }, [onLocalStream, onRemoteStream, onError]);

  // クリーンアップ関数
  const cleanup = useCallback(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (disconnectedRestartTimerRef.current) {
      if (typeof window !== 'undefined') {
        window.clearTimeout(disconnectedRestartTimerRef.current);
      }
      disconnectedRestartTimerRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach(track => track.stop());
      remoteStreamRef.current = null;
    }
    videoSenderRef.current = null;
    isNegotiatingRef.current = false;
    setCallState('idle');
    setCurrentCallId(null);
    setIsVideoEnabled(false);
    setIncomingCallInfo(null);
    setLocalStream(null);
    setRemoteStream(null);
    pcConnectionStartTimeRef.current = null;
    pcIceConnectionStartTimeRef.current = null;
    // call関数のエラーハンドリング用：エラーレスポンス待機を解除
    if (callErrorPromiseRef.current) {
      callErrorPromiseRef.current.resolve();
      callErrorPromiseRef.current = null;
    }
  }, []);

  // シグナリング（ref化してhandlersから参照可能にする）
  const signalingRef = useRef<ReturnType<typeof useWebRTCSignaling> | null>(null);

  // シグナリングハンドラー
  const handlers = useMemo(() => ({
    onIncomingCall: (callId: string, from: string, payload?: { callerName?: string; callerLocation?: string | null }) => {
      setIncomingCallInfo({
        callId,
        from,
        callerName: payload?.callerName,
        callerLocation: payload?.callerLocation ?? null
      });
      setCallState('incoming');
    },
    onCallAccepted: async (callId: string) => {
      // call関数のエラーハンドリング用：エラーレスポンス待機を解除
      if (callErrorPromiseRef.current) {
        callErrorPromiseRef.current.resolve();
        callErrorPromiseRef.current = null;
      }
      currentCallIdRef.current = callId;
      setCurrentCallId(callId);
      setCallState('connecting');
      const startCallFn = startCallRef.current;
      if (startCallFn) {
        await startCallFn(callId, false);
      }
    },
    onCallRejected: (callId: string) => {
      if (callId === currentCallIdRef.current) {
        // call関数のエラーハンドリング用：エラーレスポンス待機を解除
        if (callErrorPromiseRef.current) {
          callErrorPromiseRef.current.resolve();
          callErrorPromiseRef.current = null;
        }
        cleanup();
      }
    },
    onCallCancelled: (callId: string) => {
      if (callId === currentCallIdRef.current) {
        // call関数のエラーハンドリング用：エラーレスポンス待機を解除
        if (callErrorPromiseRef.current) {
          callErrorPromiseRef.current.resolve();
          callErrorPromiseRef.current = null;
        }
        cleanup();
      }
    },
    onCallHangup: (callId: string) => {
      if (callId === currentCallIdRef.current) {
        cleanup();
      }
    },
    onOffer: async (message: SignalingMessage) => {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTC.ts:handlers.onOffer',message:'signal_offer_received',data:{callId:message.callId,hasPc:Boolean(peerConnectionRef.current),curCallId:currentCallIdRef.current},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      if (!peerConnectionRef.current || message.callId !== currentCallIdRef.current || !message.payload) {
        return;
      }

      try {
        const pc = peerConnectionRef.current;
        const offer = message.payload as RTCSessionDescriptionInit;
        // offer衝突(glare)対策: こちらがhave-local-offer等で不安定な場合はrollbackしてから受理する
        if (pc.signalingState !== 'stable') {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await pc.setLocalDescription({ type: 'rollback' } as any);
          } catch {
            // ignore: rollback非対応環境もある
          }
        }
        await pc.setRemoteDescription(offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        signalingRef.current?.sendMessage({
          type: 'answer',
          callId: currentCallIdRef.current!,
          payload: answer
        });
      } catch (error) {
        onErrorRef.current?.(error instanceof Error ? error : new Error('Failed to handle offer'));
      }
    },
    onAnswer: async (message: SignalingMessage) => {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTC.ts:handlers.onAnswer',message:'signal_answer_received',data:{callId:message.callId,hasPc:Boolean(peerConnectionRef.current),curCallId:currentCallIdRef.current},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      // 相手からのAnswerを受信
      if (!peerConnectionRef.current || message.callId !== currentCallIdRef.current || !message.payload) {
        return;
      }

      try {
        const pc = peerConnectionRef.current;
        const answer = message.payload as RTCSessionDescriptionInit;
        // Answerは「自分がofferを出している」状態でのみ適用する（それ以外は衝突/順序違い）
        if (pc.signalingState !== 'have-local-offer') {
          return;
        }
        await pc.setRemoteDescription(answer);
      } catch (error) {
        onErrorRef.current?.(error instanceof Error ? error : new Error('Failed to handle answer'));
      }
    },
    onIceCandidate: async (message: SignalingMessage) => {
      // ICE candidateを受信
      if (!peerConnectionRef.current || message.callId !== currentCallIdRef.current || !message.payload) {
        return;
      }

      try {
        const candidate = message.payload as RTCIceCandidateInit;
        await peerConnectionRef.current.addIceCandidate(candidate);
      } catch (error) {
        onErrorRef.current?.(error instanceof Error ? error : new Error('Failed to add ICE candidate'));
      }
    },
    onError: (error: Error) => {
      // 発信中（ringing）の状態でエラーが発生した場合、idleに戻す
      if (callStateRef.current === 'ringing') {
        cleanup();
        // call関数のエラーハンドリング用：エラーレスポンスを待機している場合はreject
        if (callErrorPromiseRef.current) {
          callErrorPromiseRef.current.reject(error);
          callErrorPromiseRef.current = null;
        }
      }
      onErrorRef.current?.(error);
    }
  }), [cleanup]);

  // シグナリング
  const signaling = useWebRTCSignaling({
    enabled,
    ...handlers
  });
  signalingRef.current = signaling;

  // WebRTC設定（Pi4向けに最適化）
  const getRTCConfiguration = useCallback((): RTCConfiguration => {
    return {
      iceServers: [
        // STUNサーバー（NAT越え用、ローカルLANでは不要だが互換性のため）
        { urls: 'stun:stun.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 0 // ローカルLANなのでプール不要
    };
  }, []);

  const renegotiate = useCallback(async (reason: 'enableVideo' | 'iceRestart') => {
    const pc = peerConnectionRef.current;
    const callId = currentCallIdRef.current;
    if (!pc || !callId) return;
    // signalingStateが不安定な間はofferを作らない（状態崩壊の原因）
    if (pc.signalingState !== 'stable') return;
    if (isNegotiatingRef.current) return;
    isNegotiatingRef.current = true;
    try {
      const offer =
        reason === 'iceRestart'
          ? await pc.createOffer({ iceRestart: true })
          : await pc.createOffer();
      await pc.setLocalDescription(offer);
      signalingRef.current?.sendMessage({
        type: 'offer',
        callId,
        payload: offer
      });
    } finally {
      isNegotiatingRef.current = false;
    }
  }, []);

  const scheduleIceRestart = useCallback(() => {
    if (disconnectedRestartTimerRef.current) return;
    if (typeof window === 'undefined') return;
    // 一時的なネットワーク揺れで即再ネゴしないよう、少し待ってからICE restart
    disconnectedRestartTimerRef.current = window.setTimeout(() => {
      disconnectedRestartTimerRef.current = null;
      void renegotiate('iceRestart');
    }, 2500);
  }, [renegotiate]);

  // RTCPeerConnectionの作成
  const createPeerConnection = useCallback((): RTCPeerConnection => {
    const pc = new RTCPeerConnection(getRTCConfiguration());

    // リモートストリームの受信
    pc.ontrack = (event) => {
      // event.streams[0] に依存すると、音声/映像で別Streamが届く環境でUIが不安定になる。
      // 受信トラックを単一のMediaStreamに集約して扱う。
      const existing = remoteStreamRef.current ?? new MediaStream();
      const track = event.track;
      try {
        if (!existing.getTracks().some((t) => t.id === track.id)) {
          existing.addTrack(track);
        }
      } catch {
        // ignore
      }
      remoteStreamRef.current = existing;
      onRemoteStreamRef.current?.(existing);
      setRemoteStream(toUiStream(existing));

      const refresh = () => {
        const cur = remoteStreamRef.current;
        if (!cur) return;
        setRemoteStream(toUiStream(cur));
      };
      track.onended = refresh;
      track.onmute = refresh;
      track.onunmute = refresh;
    };

    // ICE candidateの処理
    pc.onicecandidate = (event) => {
      const callId = currentCallIdRef.current;
      if (event.candidate && callId) {
        // signalingはref経由でアクセスするため、依存関係に含めない
        // eslint-disable-next-line react-hooks/exhaustive-deps
        signalingRef.current?.sendMessage({
          type: 'ice-candidate',
          callId,
          payload: event.candidate
        });
      }
    };

    // 接続状態の監視
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      const now = Date.now();
      if (state === 'connected') {
        if (!pcConnectionStartTimeRef.current) {
          pcConnectionStartTimeRef.current = now;
        }
        setCallState('connected');
      }
      if (state === 'failed' || state === 'disconnected') {
        scheduleIceRestart();
      }
      if (state === 'closed') {
        cleanup();
      }
    };

    pc.oniceconnectionstatechange = () => {
      const ice = pc.iceConnectionState;
      if (ice === 'connected' || ice === 'completed') {
        if (!pcIceConnectionStartTimeRef.current) {
          pcIceConnectionStartTimeRef.current = Date.now();
        }
        return;
      }
      if (ice === 'failed' || ice === 'disconnected') {
        scheduleIceRestart();
      }
    };

    return pc;
  }, [cleanup, getRTCConfiguration, onRemoteStreamRef, scheduleIceRestart, toUiStream]);

  // 通話開始（音声のみ）
  const startCall = useCallback(async (callId: string, withVideo: boolean = false) => {
    try {
      // RTCPeerConnectionを作成
      const pc = createPeerConnection();
      peerConnectionRef.current = pc;

      // ローカルストリームを取得（失敗しても受信専用で継続できるようにする）
      let stream: MediaStream | null = null;
      try {
        stream = withVideo ? await getAudioVideoStream() : await getAudioStream();
        localStreamRef.current = stream;
        onLocalStreamRef.current?.(stream);
        setLocalStream(toUiStream(stream));

        // ローカルストリームを追加
        stream.getTracks().forEach((track) => {
          pc.addTrack(track, stream!);
        });
      } catch (e) {
        // ローカル音声が取得できない端末（マイク未接続等）でも通話確立できるようにする
        // 発信側がマイク無しでも、音声を受信できるようにトランシーバを追加（m-lineを生成）
        try {
          pc.addTransceiver('audio', { direction: 'recvonly' });
        } catch {
          // ignore（古いブラウザ等）
        }
      }

      // Offerを作成
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // Offerを送信
      signaling.sendMessage({
        type: 'offer',
        callId,
        payload: offer
      });
      setCallState('connecting');
      setIsVideoEnabled(withVideo);
    } catch (error) {
      cleanup();
      onErrorRef.current?.(error instanceof Error ? error : new Error('Failed to start call'));
    }
  }, [createPeerConnection, signaling, cleanup, toUiStream]);
  startCallRef.current = startCall;

  // 発信
  const call = useCallback(async (to: string): Promise<void> => {
    if (callState !== 'idle') {
      throw new Error('Call already in progress');
    }

    // WebSocket接続を確認
    if (!signaling.isConnected) {
      const error = new Error('WebSocket not connected');
      onErrorRef.current?.(error);
      throw error;
    }

    const callId = `call-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    setCurrentCallId(callId);
    
    // エラーレスポンスを待機するためのPromiseを作成
    const errorPromise = new Promise<void>((resolve, reject) => {
      callErrorPromiseRef.current = { resolve, reject };
    });

    // 発信メッセージを送信（エラーが発生した場合はthrow）
    // エラーはWebSocket経由でonErrorハンドラーに通知される
    // サーバー側でhasCalleeSocket: falseの場合、エラーメッセージが返される
    try {
      signaling.sendMessage({
        type: 'invite',
        to,
        callId
      });
      // メッセージ送信が成功した場合のみringing状態に設定
      setCallState('ringing');
    } catch (error) {
      // sendMessageでエラーが発生した場合、Promiseをクリアしてエラーをthrow
      callErrorPromiseRef.current = null;
      throw error;
    }

    // エラーレスポンスを待機（最大1秒）
    // エラーが発生した場合はreject、エラーが発生しない場合はresolve
    try {
      await Promise.race([
        errorPromise,
        new Promise<void>((resolve) => {
          setTimeout(() => {
            // 1秒以内にエラーが発生しなかった場合、エラーレスポンス待機を解除
            if (callErrorPromiseRef.current) {
              callErrorPromiseRef.current.resolve();
              callErrorPromiseRef.current = null;
            }
            resolve();
          }, 1000);
        })
      ]);
    } catch (error) {
      // エラーが発生した場合はthrow
      callErrorPromiseRef.current = null;
      throw error;
    }
    
    // 相手が受話するまで待機（onCallAcceptedでstartCallが呼ばれる）
  }, [callState, signaling]);

  // 受話
  const accept = useCallback(async () => {
    if (callState !== 'incoming' || !incomingCallInfo) {
      return;
    }

    const callId = incomingCallInfo.callId;
    setCurrentCallId(callId);

    // 受話メッセージを送信
    signaling.sendMessage({
      type: 'accept',
      callId
    });
    // 受話側は offer を「送らない」。PeerConnection を準備して offer を待つ。
    setCallState('connecting');

    if (!peerConnectionRef.current) {
      peerConnectionRef.current = createPeerConnection();
    }

    // 可能ならローカル音声を付与（Pi4などマイク無しでも受信専用で成立させる）
    try {
      const stream = await getAudioStream();
      localStreamRef.current = stream;
      onLocalStreamRef.current?.(stream);
      setLocalStream(toUiStream(stream));
      stream.getTracks().forEach((track) => {
        peerConnectionRef.current?.addTrack(track, stream);
      });
    } catch (e) {
      // ローカル音声が取得できない端末（マイク未接続等）でも通話確立できるようにする
    }
  }, [callState, incomingCallInfo, signaling, createPeerConnection, toUiStream]);

  // 拒否
  const reject = useCallback(() => {
    if (callState !== 'incoming' || !incomingCallInfo) {
      return;
    }

    signaling.sendMessage({
      type: 'reject',
      callId: incomingCallInfo.callId
    });

    cleanup();
  }, [callState, incomingCallInfo, signaling, cleanup]);

  // 切断
  const hangup = useCallback(() => {
    if (currentCallId) {
      signaling.sendMessage({
        type: 'hangup',
        callId: currentCallId
      });
    }
    cleanup();
  }, [currentCallId, signaling, cleanup]);

  // ビデオを有効化
  const enableVideo = useCallback(async () => {
    if (!peerConnectionRef.current || !currentCallId || isVideoEnabled) {
      return;
    }

    try {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTC.ts:enableVideo',message:'enableVideo_start',data:{callId:currentCallId,signalingState:peerConnectionRef.current?.signalingState},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      const pcForVideo = peerConnectionRef.current;
      if (pcForVideo.signalingState !== 'stable') return;
      
      // 既存のビデオトラックがliveなら、それを再有効化（toggle時のフリーズを避ける）
      const existingVideo = localStreamRef.current?.getVideoTracks()?.[0] ?? null;
      if (existingVideo && existingVideo.readyState === 'live') {
        existingVideo.enabled = true;
        setIsVideoEnabled(true);
        setLocalStream(toUiStream(localStreamRef.current));
        return;
      }

      // ビデオストリームを取得（マイクが利用できない端末でもビデオのみで継続できるように）
      const videoStream = await getVideoStream();
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTC.ts:enableVideo',message:'enableVideo_gotVideoStream',data:{hasStream:Boolean(videoStream),videoTracks:videoStream?.getVideoTracks?.().length ?? null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion

      if (!videoStream || videoStream.getVideoTracks().length === 0) {
        throw new Error('ビデオストリームの取得に失敗しました');
      }
      // ビデオトラックを追加
      const videoTrack = videoStream.getVideoTracks()[0];
      if (videoTrack && peerConnectionRef.current) {
        // ローカルストリーム（UI/操作用）に必ず格納する
        if (!localStreamRef.current) {
          localStreamRef.current = new MediaStream();
        }
        if (!localStreamRef.current.getTracks().some((t) => t.id === videoTrack.id)) {
          try {
            localStreamRef.current.addTrack(videoTrack);
          } catch {
            // ignore
          }
        }
        onLocalStreamRef.current?.(localStreamRef.current);
        setLocalStream(toUiStream(localStreamRef.current));

        const hadSender = Boolean(videoSenderRef.current);
        if (videoSenderRef.current) {
          // 既存senderがあるならreplaceTrackで差し替え（再ネゴ不要）
          await videoSenderRef.current.replaceTrack(videoTrack);
        } else {
          // 初回のみaddTrackしてm-lineを作る（再ネゴ必要）
          videoSenderRef.current = peerConnectionRef.current.addTrack(videoTrack, localStreamRef.current);
        }

        if (!hadSender) {
          await renegotiate('enableVideo');
        }
        setIsVideoEnabled(true);
      }
    } catch (error) {
      onErrorRef.current?.(error instanceof Error ? error : new Error('Failed to enable video'));
    }
  }, [currentCallId, isVideoEnabled, renegotiate, toUiStream]);

  // ビデオを無効化
  const disableVideo = useCallback(() => {
    if (!peerConnectionRef.current || !isVideoEnabled) {
      return;
    }

    // stop/remove すると相手側が「最後のフレームで停止」しやすいので、enabled=falseで送信を止める
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = false;
    });
    setLocalStream(toUiStream(localStreamRef.current));

    setIsVideoEnabled(false);
  }, [isVideoEnabled, toUiStream]);


  // クリーンアップ（アンマウント時のみ）
  // cleanupはuseCallback([])で安定しているが、useEffect依存に含めると
  // React StrictMode等で二重実行される可能性があるため、依存配列は空にする
  useEffect(() => {
    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // デバッグログ：状態遷移の観測（cleanupは呼ばない）
  useEffect(() => {
    callStateRef.current = callState;
    currentCallIdRef.current = currentCallId;
    hasIncomingRef.current = Boolean(incomingCallInfo);
  }, [callState, currentCallId, incomingCallInfo]);

  return {
    callState,
    currentCallId,
    isVideoEnabled,
    incomingCallInfo,
    localStream,
    remoteStream,
    call,
    accept,
    reject,
    hangup,
    enableVideo,
    disableVideo,
    isConnected: signaling.isConnected
  };
}

