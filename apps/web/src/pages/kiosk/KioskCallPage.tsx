/**
 * キオスク通話ページ
 * クライアント一覧から相手を選んで発信、着信対応、通話中UI
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useKioskCallTargets } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { VIEWPORT_HEIGHT_FULL } from '../../constants/viewportLayout';
import { useWebRTCCall } from '../../features/webrtc/context/WebRTCCallContext';
export function KioskCallPage() {
  const callTargetsQuery = useKioskCallTargets();
  const selfClientId = callTargetsQuery.data?.selfClientId ?? null;
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [showIncomingModal, setShowIncomingModal] = useState(false);
  const [errorDialog, setErrorDialog] = useState<{ title: string; description?: string } | null>(null);

  const toUserFacingError = useCallback((error: Error): { title: string; description?: string } => {
    const msg = error.message || '';
    if (/Callee is not connected/i.test(msg)) {
      return {
        title: '相手のキオスクが起動していません',
        description:
          '相手端末が通話待機状態ではないため、発信できません。相手端末の電源が入っていること、ブラウザが起動していること、キオスク画面/サイネージ画面が表示されていることを確認してから再試行してください。',
      };
    }
    if (/WebSocket not connected/i.test(msg)) {
      return {
        title: '通話サーバーに接続できません',
        description: 'ネットワーク接続を確認して、しばらく待ってから再試行してください。',
      };
    }
    if (/already in a call/i.test(msg)) {
      return {
        title: '相手は通話中です',
        description: '相手端末が別の通話中のため発信できません。時間をおいて再試行してください。',
      };
    }
    if (/Other participant not connected/i.test(msg)) {
      return {
        title: '相手が切断されました',
        description: '相手端末との接続が切れました。相手端末の状態を確認してから再試行してください。',
      };
    }
    return {
      title: 'エラー',
      description: msg ? `エラーが発生しました: ${msg}` : 'エラーが発生しました。',
    };
  }, []);

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
    setErrorDialog(toUserFacingError(lastError));
    clearLastError();
  }, [lastError, clearLastError, toUserFacingError]);

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
    try {
      await call(to);
    } catch (error) {
      console.error('Failed to call:', error);
      setErrorDialog(toUserFacingError(error instanceof Error ? error : new Error(String(error))));
    }
  };

  const handleAccept = async () => {
    try {
      await accept();
      setShowIncomingModal(false);
    } catch (error) {
      console.error('Failed to accept:', error);
      setErrorDialog(toUserFacingError(error instanceof Error ? error : new Error(String(error))));
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
    try {
      await enableVideo();
    } catch (error) {
      console.error('Failed to enable video:', error);
      setErrorDialog(toUserFacingError(error instanceof Error ? error : new Error(String(error))));
    }
  };

  const handleDisableVideo = () => {
    disableVideo();
  };

  const hasLocalVideo = Boolean(localStream && localStream.getVideoTracks().length > 0);
  const hasRemoteVideo = Boolean(remoteStream && remoteStream.getVideoTracks().length > 0);

  return (
    <div className={`flex flex-col bg-slate-100 p-4 ${VIEWPORT_HEIGHT_FULL}`}>
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

      {/* エラーダイアログ（ユーザー向け） */}
      <Dialog
        isOpen={Boolean(errorDialog)}
        onClose={() => setErrorDialog(null)}
        title={errorDialog?.title}
        description={errorDialog?.description}
        ariaLabel="通話エラー"
        size="md"
      >
        <div className="mt-4 flex justify-end">
          <Button type="button" onClick={() => setErrorDialog(null)}>
            OK
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

