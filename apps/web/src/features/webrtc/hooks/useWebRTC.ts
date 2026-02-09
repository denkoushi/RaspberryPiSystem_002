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

  // デバッグログ用：最新stateを参照するためのref（Hook依存関係の警告回避）
  const callStateRef = useRef<CallState>('idle');
  const currentCallIdRef = useRef<string | null>(null);
  const hasIncomingRef = useRef(false);

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
    pcConnectionStartTimeRef.current = null;
    pcIceConnectionStartTimeRef.current = null;
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
        cleanup();
      }
    },
    onCallCancelled: (callId: string) => {
      if (callId === currentCallIdRef.current) {
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

  // RTCPeerConnectionの作成
  const createPeerConnection = useCallback((): RTCPeerConnection => {
    const pc = new RTCPeerConnection(getRTCConfiguration());

    // リモートストリームの受信
    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        const stream = event.streams[0];
        remoteStreamRef.current = stream;
        onRemoteStreamRef.current?.(stream);
      }
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
    };

    return pc;
  }, [getRTCConfiguration, onRemoteStreamRef]);

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
  }, [createPeerConnection, signaling, cleanup]);
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
    setCallState('ringing');

    // 発信メッセージを送信
    // エラーはWebSocket経由でonErrorハンドラーに通知される
    // サーバー側でhasCalleeSocket: falseの場合、エラーメッセージが返される
    signaling.sendMessage({
      type: 'invite',
      to,
      callId
    });
    // 相手が受話するまで待機（onCallAcceptedでstartCallが呼ばれる）
    // エラーはWebSocket経由でonErrorハンドラーに通知される
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
      stream.getTracks().forEach((track) => {
        peerConnectionRef.current?.addTrack(track, stream);
      });
    } catch (e) {
      // ローカル音声が取得できない端末（マイク未接続等）でも通話確立できるようにする
    }
  }, [callState, incomingCallInfo, signaling, createPeerConnection]);

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
      // 再ネゴシエーション中は新しいofferを作らない（状態崩壊の原因）
      if (pcForVideo.signalingState !== 'stable') {
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
      // 既存のビデオトラックを停止
      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach(track => track.stop());
      }

      // ビデオトラックを追加
      const videoTrack = videoStream.getVideoTracks()[0];
      if (videoTrack && peerConnectionRef.current) {
        // 既存のvideo senderがあれば先に外す（保険）
        if (videoSenderRef.current) {
          try {
            peerConnectionRef.current.removeTrack(videoSenderRef.current);
          } catch {
            // ignore
          }
          videoSenderRef.current = null;
        }

        // addTrackはRTCRtpSenderを返すので保持（disableVideoでremoveTrackする）
        videoSenderRef.current = peerConnectionRef.current.addTrack(videoTrack, videoStream);
        // 既存の音声ストリームにビデオトラックを追加
        if (localStreamRef.current) {
          localStreamRef.current.addTrack(videoTrack);
        } else {
          localStreamRef.current = videoStream;
        }
        onLocalStreamRef.current?.(localStreamRef.current);

        // 再ネゴシエーション
        isNegotiatingRef.current = true;
        const offer = await peerConnectionRef.current.createOffer();
        await peerConnectionRef.current.setLocalDescription(offer);
        signaling.sendMessage({
          type: 'offer',
          callId: currentCallId,
          payload: offer
        });
        setIsVideoEnabled(true);
      }
    } catch (error) {
      onErrorRef.current?.(error instanceof Error ? error : new Error('Failed to enable video'));
    }
  }, [peerConnectionRef, currentCallId, isVideoEnabled, signaling]);

  // ビデオを無効化
  const disableVideo = useCallback(() => {
    if (!peerConnectionRef.current || !isVideoEnabled) {
      return;
    }

    // addTrackで返したsenderをremoveTrackする（removeTrackはRTCRtpSenderを要求）
    if (videoSenderRef.current) {
      try {
        peerConnectionRef.current.removeTrack(videoSenderRef.current);
      } catch {
        // ignore
      }
      videoSenderRef.current = null;
    }

    // ローカルストリームからビデオトラックを外して停止
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      try {
        localStreamRef.current?.removeTrack(track);
      } catch {
        // ignore
      }
      track.stop();
    });

    setIsVideoEnabled(false);
  }, [peerConnectionRef, isVideoEnabled]);


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
    localStream: localStreamRef.current,
    remoteStream: remoteStreamRef.current,
    call,
    accept,
    reject,
    hangup,
    enableVideo,
    disableVideo,
    isConnected: signaling.isConnected
  };
}

