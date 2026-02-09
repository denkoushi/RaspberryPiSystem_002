/**
 * キオスク通話ページ
 * クライアント一覧から相手を選んで発信、着信対応、通話中UI
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { useKioskCallTargets } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useWebRTCCall } from '../../features/webrtc/context/WebRTCCallContext';
export function KioskCallPage() {
  const callTargetsQuery = useKioskCallTargets();
  const selfClientId = callTargetsQuery.data?.selfClientId ?? null;
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [showIncomingModal, setShowIncomingModal] = useState(false);
  const lastAlertAtRef = useRef<number>(0);

  const {
    callState,
    incomingCallInfo,
    isVideoEnabled,
    localStream,
    remoteStream,
    lastError,
    clearLastError,
    call,
    accept,
    reject,
    hangup,
    enableVideo,
    disableVideo,
    isConnected
  } = useWebRTCCall();

  // 着信時にモーダルを表示
  useEffect(() => {
    if (callState === 'incoming' && incomingCallInfo) {
      setShowIncomingModal(true);
    } else {
      setShowIncomingModal(false);
    }
  }, [callState, incomingCallInfo]);

  useEffect(() => {
    if (!lastError) return;
    console.error('WebRTC error:', lastError);
    const now = Date.now();
    if (now - lastAlertAtRef.current > 3000) {
      lastAlertAtRef.current = now;
      alert(`エラーが発生しました: ${lastError.message}`);
    }
    clearLastError();
  }, [lastError, clearLastError]);

  // video要素が「後から」マウントされるケース（条件レンダリング）に備えて、ストリームを再バインドする
  useEffect(() => {
    const stream = localStream ?? null;
    const el = localVideoRef.current;
    if (!el || !stream || stream.getVideoTracks().length === 0) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
    void el.play().catch(() => {
      // autoplay失敗は無視（ユーザー操作で再生可能）
    });
  }, [localStream, isVideoEnabled, callState]);

  useEffect(() => {
    const stream = remoteStream ?? null;
    const el = remoteVideoRef.current;
    if (!el || !stream || stream.getVideoTracks().length === 0) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
    void el.play().catch(() => {
      // autoplay失敗は無視（ユーザー操作で再生可能）
    });
  }, [remoteStream, isVideoEnabled, callState]);

  // 発信先一覧（location優先でソート）
  const availableClients = useMemo(() => {
    const targets = callTargetsQuery.data?.targets ?? [];
    return targets
      .filter((t) => !t.stale)
      .filter((t) => (selfClientId ? t.clientId !== selfClientId : true))
      .map((t) => ({
        clientId: t.clientId,
        name: t.name || t.hostname,
        location: t.location,
        ipAddress: t.ipAddress
      }))
      .sort((a, b) => {
        // location優先でソート（locationがnullの場合は後ろに）
        if (a.location && !b.location) return -1;
        if (!a.location && b.location) return 1;
        if (a.location && b.location) {
          return a.location.localeCompare(b.location);
        }
        return a.name.localeCompare(b.name);
      });
  }, [callTargetsQuery.data, selfClientId]);

  const handleCall = async (to: string) => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'KioskCallPage.tsx:handleCall',message:'user_action_call',data:{to,callState,isConnected},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    try {
      await call(to);
    } catch (error) {
      console.error('Failed to call:', error);
      alert(`発信に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleAccept = async () => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'KioskCallPage.tsx:handleAccept',message:'user_action_accept',data:{callState,hasIncoming:Boolean(incomingCallInfo)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    try {
      await accept();
      setShowIncomingModal(false);
    } catch (error) {
      console.error('Failed to accept:', error);
      alert(`受話に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleReject = () => {
    reject();
    setShowIncomingModal(false);
  };

  const handleHangup = () => {
    hangup();
  };

  const handleEnableVideo = async () => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'KioskCallPage.tsx:handleEnableVideo',message:'user_action_enableVideo',data:{callState,isVideoEnabled},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    try {
      await enableVideo();
    } catch (error) {
      console.error('Failed to enable video:', error);
      alert(`ビデオの有効化に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleDisableVideo = () => {
    disableVideo();
  };

  const hasLocalVideo = Boolean(localStream && localStream.getVideoTracks().length > 0);
  const hasRemoteVideo = Boolean(remoteStream && remoteStream.getVideoTracks().length > 0);

  return (
    <div className="flex h-screen flex-col bg-slate-100 p-4">
      {/* ヘッダー */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-900">通話</h1>
        <p className="text-sm text-slate-600">
          {isConnected ? '接続中' : '接続待機中...'} | 状態: {callState}
        </p>
      </div>

      {/* 通話中UI */}
      {callState === 'connected' || callState === 'connecting' ? (
        <Card className="flex-1">
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="grid grid-cols-2 gap-4 w-full max-w-4xl">
              {/* リモートビデオ */}
              <div className="relative aspect-video rounded-lg bg-black">
                {hasRemoteVideo ? (
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="h-full w-full rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-white">
                    <div className="text-center">
                      <div className="mb-2 text-4xl">📞</div>
                      <div>音声通話中</div>
                    </div>
                  </div>
                )}
              </div>

              {/* ローカルビデオ */}
              {hasLocalVideo ? (
                <div className="relative aspect-video rounded-lg bg-black">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full rounded-lg object-cover"
                  />
                </div>
              ) : null}
            </div>

            {/* コントロール */}
            <div className="flex gap-4">
              {!isVideoEnabled ? (
                <Button onClick={handleEnableVideo} variant="secondary">
                  📹 ビデオを有効化
                </Button>
              ) : (
                <Button onClick={handleDisableVideo} variant="secondary">
                  📹 ビデオを無効化
                </Button>
              )}
              <Button onClick={handleHangup} variant="primary" className="bg-red-500 hover:bg-red-600">
                📞 切断
              </Button>
            </div>
          </div>
        </Card>
      ) : callState === 'ringing' ? (
        <Card className="flex-1">
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="mb-4 text-6xl">📞</div>
              <div className="text-xl font-bold">発信中...</div>
            </div>
          </div>
        </Card>
      ) : (
        /* 発信先一覧 */
        <Card className="flex-1">
          <div className="space-y-2">
            {callTargetsQuery.isLoading ? (
              <p className="text-center text-slate-600">読み込み中...</p>
            ) : callTargetsQuery.isError ? (
              <p className="text-center text-red-600">エラーが発生しました</p>
            ) : availableClients.length === 0 ? (
              <p className="text-center text-slate-600">発信可能な端末がありません</p>
            ) : (
              availableClients.map((client) => (
                <div
                  key={client.clientId}
                  className="flex items-center justify-between rounded-lg border-2 border-slate-300 bg-white p-4 hover:bg-slate-50"
                >
                  <div>
                    <div className="font-bold text-slate-900">
                      {client.location || '場所未設定'} - {client.name}
                    </div>
                    <div className="text-sm text-slate-600">{client.ipAddress}</div>
                  </div>
                  <Button
                    onClick={() => handleCall(client.clientId)}
                    disabled={callState !== 'idle' || !isConnected}
                    variant="primary"
                  >
                    📞 発信
                  </Button>
                </div>
              ))
            )}
          </div>
        </Card>
      )}

      {/* 着信モーダル */}
      {showIncomingModal && incomingCallInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <Card className="w-full max-w-md">
            <div className="space-y-4">
              <div className="text-center">
                <div className="mb-4 text-6xl">📞</div>
                <div className="text-xl font-bold">着信</div>
                <div className="mt-2 text-lg">
                  {incomingCallInfo.callerLocation || '場所未設定'} - {incomingCallInfo.callerName || incomingCallInfo.from}
                </div>
              </div>
              <div className="flex gap-4">
                <Button onClick={handleReject} variant="secondary" className="flex-1 bg-red-500 hover:bg-red-600">
                  拒否
                </Button>
                <Button onClick={handleAccept} variant="primary" className="flex-1">
                  受話
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

