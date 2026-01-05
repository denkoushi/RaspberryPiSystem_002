/**
 * WebRTCメインフック
 * RTCPeerConnectionを管理し、音声のみで開始→ビデオ追加に対応
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { getAudioStream, getAudioVideoStream, getVideoStream, stopMediaStream } from '../utils/media';

import { useWebRTCSignaling } from './useWebRTCSignaling';

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

  useEffect(() => {
    onLocalStreamRef.current = onLocalStream;
    onRemoteStreamRef.current = onRemoteStream;
    onErrorRef.current = onError;
  }, [onLocalStream, onRemoteStream, onError]);

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
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTC.ts:ontrack',message:'remote track received',data:{hasStreams:!!event.streams,streamCount:event.streams?.length||0,hasTracks:!!event.track,kind:event.track?.kind||null,enabled:event.track?.enabled||null,muted:event.track?.muted||null,readyState:event.track?.readyState||null},timestamp:Date.now(),sessionId:'debug-session',runId:'run-track',hypothesisId:'V3'})}).catch(()=>{});
      // #endregion
      if (event.streams && event.streams[0]) {
        const stream = event.streams[0];
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTC.ts:ontrack',message:'remote stream set',data:{audioTracks:stream.getAudioTracks().length,videoTracks:stream.getVideoTracks().length,videoTrackIds:stream.getVideoTracks().map(t=>t.id)},timestamp:Date.now(),sessionId:'debug-session',runId:'run-track',hypothesisId:'V3'})}).catch(()=>{});
        // #endregion
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
        signaling.sendMessage({
          type: 'ice-candidate',
          callId,
          payload: event.candidate
        });
      }
    };

    // 接続状態の監視
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        setCallState('connected');
      } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        setCallState('ended');
        cleanup();
      }
    };

    // ICE接続状態の監視（'completed' は iceConnectionState に存在する）
    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      if (iceState === 'connected' || iceState === 'completed') {
        setCallState('connected');
      } else if (iceState === 'disconnected' || iceState === 'failed' || iceState === 'closed') {
        setCallState('ended');
        cleanup();
      }
    };

    return pc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRemoteStream]);

  // クリーンアップ
  const cleanup = useCallback(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    stopMediaStream(localStreamRef.current);
    localStreamRef.current = null;
    stopMediaStream(remoteStreamRef.current);
    remoteStreamRef.current = null;
    setCurrentCallId(null);
    setIsVideoEnabled(false);
    setIncomingCallInfo(null);
    setCallState('idle');
    onLocalStreamRef.current?.(null);
    onRemoteStreamRef.current?.(null);
  }, []);

  // シグナリングフック
  const signaling = useWebRTCSignaling({
    enabled,
    onIncomingCall: (callId, from, payload) => {
      setIncomingCallInfo({
        callId,
        from,
        callerName: payload?.callerName,
        callerLocation: payload?.callerLocation || null
      });
      setCallState('incoming');
    },
    onCallAccepted: async (callId) => {
      setCurrentCallId(callId);
      setCallState('connecting');
      await startCall(callId, false); // 音声のみで開始
    },
    onCallRejected: (callId) => {
      if (callId === currentCallId) {
        cleanup();
      }
    },
    onCallCancelled: (callId) => {
      if (callId === currentCallId) {
        cleanup();
      }
    },
    onCallHangup: (callId) => {
      if (callId === currentCallId) {
        cleanup();
      }
    },
    onOffer: async (message) => {
      // 相手からのOfferを受信
      if (!peerConnectionRef.current || message.callId !== currentCallIdRef.current || !message.payload) {
        return;
      }

      try {
        const pc = peerConnectionRef.current;
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTC.ts:onOffer',message:'onOffer received',data:{callId:message.callId,signalingState:pc.signalingState,iceConnectionState:pc.iceConnectionState,connectionState:pc.connectionState},timestamp:Date.now(),sessionId:'debug-session',runId:'run-negotiation',hypothesisId:'N1'})}).catch(()=>{});
        // #endregion
        const offer = message.payload as RTCSessionDescriptionInit;
        // offer衝突(glare)対策: こちらがhave-local-offer等で不安定な場合はrollbackしてから受理する
        if (pc.signalingState !== 'stable') {
          try {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTC.ts:onOffer',message:'onOffer: rollback local description (glare)',data:{callId:message.callId,signalingStateBefore:pc.signalingState},timestamp:Date.now(),sessionId:'debug-session',runId:'run-negotiation',hypothesisId:'N1'})}).catch(()=>{});
            // #endregion
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await pc.setLocalDescription({ type: 'rollback' } as any);
          } catch {
            // ignore: rollback非対応環境もある
          }
        }
        await pc.setRemoteDescription(offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        signaling.sendMessage({
          type: 'answer',
          callId: currentCallIdRef.current!,
          payload: answer
        });
      } catch (error) {
        onErrorRef.current?.(error instanceof Error ? error : new Error('Failed to handle offer'));
      }
    },
    onAnswer: async (message) => {
      // 相手からのAnswerを受信
      if (!peerConnectionRef.current || message.callId !== currentCallIdRef.current || !message.payload) {
        return;
      }

      try {
        const pc = peerConnectionRef.current;
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTC.ts:onAnswer',message:'onAnswer received',data:{callId:message.callId,signalingState:pc.signalingState,localType:pc.localDescription?.type||null,remoteType:pc.remoteDescription?.type||null},timestamp:Date.now(),sessionId:'debug-session',runId:'run-negotiation',hypothesisId:'N2'})}).catch(()=>{});
        // #endregion
        const answer = message.payload as RTCSessionDescriptionInit;
        // Answerは「自分がofferを出している」状態でのみ適用する（それ以外は衝突/順序違い）
        if (pc.signalingState !== 'have-local-offer') {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTC.ts:onAnswer',message:'onAnswer ignored: wrong signalingState',data:{callId:message.callId,signalingState:pc.signalingState},timestamp:Date.now(),sessionId:'debug-session',runId:'run-negotiation',hypothesisId:'N2'})}).catch(()=>{});
          // #endregion
          return;
        }
        await pc.setRemoteDescription(answer);
      } catch (error) {
        onErrorRef.current?.(error instanceof Error ? error : new Error('Failed to handle answer'));
      }
    },
    onIceCandidate: async (message) => {
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
    onError: (error) => {
      onErrorRef.current?.(error);
    }
  });

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

  // 発信
  const call = useCallback(async (to: string) => {
    if (callState !== 'idle') {
      return;
    }

    const callId = `call-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    setCurrentCallId(callId);
    setCallState('ringing');

    // 発信メッセージを送信
    signaling.sendMessage({
      type: 'invite',
      to,
      callId
    });

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
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTC.ts:enableVideo',message:'enableVideo begin',data:{callId:currentCallId,hasPc:!!peerConnectionRef.current},timestamp:Date.now(),sessionId:'debug-session',runId:'run-video',hypothesisId:'V1'})}).catch(()=>{});
      // #endregion

      const pcForVideo = peerConnectionRef.current;
      // 再ネゴシエーション中は新しいofferを作らない（状態崩壊の原因）
      if (pcForVideo.signalingState !== 'stable') {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTC.ts:enableVideo',message:'enableVideo skipped: signalingState not stable',data:{callId:currentCallId,signalingState:pcForVideo.signalingState},timestamp:Date.now(),sessionId:'debug-session',runId:'run-negotiation',hypothesisId:'N3'})}).catch(()=>{});
        // #endregion
        return;
      }
      
      // ビデオストリームを取得（マイクが利用できない端末でもビデオのみで継続できるように）
      let videoStream: MediaStream | null = null;
      try {
        // まずビデオのみを試す（マイク無し端末対応）
        videoStream = await getVideoStream();
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTC.ts:enableVideo',message:'getVideoStream success',data:{callId:currentCallId,videoTracks:videoStream.getVideoTracks().length,audioTracks:videoStream.getAudioTracks().length},timestamp:Date.now(),sessionId:'debug-session',runId:'run-video',hypothesisId:'V1'})}).catch(()=>{});
        // #endregion
      } catch (videoError) {
        const err = videoError as { name?: string; message?: string };
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTC.ts:enableVideo',message:'getVideoStream failed',data:{callId:currentCallId,errorName:err?.name||null,errorMessage:err?.message||String(videoError)},timestamp:Date.now(),sessionId:'debug-session',runId:'run-video',hypothesisId:'V1'})}).catch(()=>{});
        // #endregion
        // ここで audio+video にフォールバックすると「マイク無し端末」で audio が原因で失敗し、
        // エラーが分かりづらくなる（"Could not start audio source" など）。
        // enableVideo ではビデオのみを要求する。
        throw videoError;
      }

      if (!videoStream) {
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
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTC.ts:enableVideo',message:'video track added to PC',data:{callId:currentCallId,hasVideoSender:!!videoSenderRef.current},timestamp:Date.now(),sessionId:'debug-session',runId:'run-video',hypothesisId:'V2'})}).catch(()=>{});
        // #endregion
        
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
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTC.ts:enableVideo',message:'offer created and sent',data:{callId:currentCallId},timestamp:Date.now(),sessionId:'debug-session',runId:'run-video',hypothesisId:'V2'})}).catch(()=>{});
        // #endregion

        signaling.sendMessage({
          type: 'offer',
          callId: currentCallId,
          payload: offer
        });

        setIsVideoEnabled(true);
      }
    } catch (error) {
      const err = error as { name?: string; message?: string };
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useWebRTC.ts:enableVideo',message:'enableVideo failed',data:{callId:currentCallId,errorName:err?.name||null,errorMessage:err?.message||String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run-video',hypothesisId:'V1'})}).catch(()=>{});
      // #endregion
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

