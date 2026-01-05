/**
 * WebRTCメインフック
 * RTCPeerConnectionを管理し、音声のみで開始→ビデオ追加に対応
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { getAudioStream, getAudioVideoStream, stopMediaStream } from '../utils/media';

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
      if (event.streams && event.streams[0]) {
        remoteStreamRef.current = event.streams[0];
        onRemoteStreamRef.current?.(event.streams[0]);
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
        const offer = message.payload as RTCSessionDescriptionInit;
        await peerConnectionRef.current.setRemoteDescription(offer);
        const answer = await peerConnectionRef.current.createAnswer();
        await peerConnectionRef.current.setLocalDescription(answer);
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
        const answer = message.payload as RTCSessionDescriptionInit;
        await peerConnectionRef.current.setRemoteDescription(answer);
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
      // ビデオストリームを取得
      const videoStream = await getAudioVideoStream();
      
      // 既存の音声ストリームを停止
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

