/**
 * WebRTC用メディアストリームユーティリティ
 * 既存のcamera.tsとは独立したWebRTC専用の実装
 */

/**
 * 音声のみのメディアストリームを取得
 */
export async function getAudioStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('このブラウザはマイクAPIをサポートしていません。HTTPS接続またはlocalhostでのアクセスが必要です。');
  }

  try {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'media.ts:getAudioStream',message:'getUserMedia(audio) start',data:{hasMediaDevices:!!navigator.mediaDevices,hasGetUserMedia:!!navigator.mediaDevices.getUserMedia},timestamp:Date.now(),sessionId:'debug-session',runId:'run-media',hypothesisId:'M1'})}).catch(()=>{});
    // #endregion
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'media.ts:getAudioStream',message:'getUserMedia(audio) success',data:{audioTracks:stream.getAudioTracks().length,videoTracks:stream.getVideoTracks().length},timestamp:Date.now(),sessionId:'debug-session',runId:'run-media',hypothesisId:'M1'})}).catch(()=>{});
    // #endregion
    return stream;
  } catch (error) {
    const err = error as { name?: string; message?: string };
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'media.ts:getAudioStream',message:'getUserMedia(audio) failed',data:{errorName:err?.name||null,errorMessage:err?.message||String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run-media',hypothesisId:'M1'})}).catch(()=>{});
    // #endregion
    throw new Error(`マイクへのアクセスに失敗しました: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 音声＋ビデオのメディアストリームを取得
 * Pi4向けに最適化された設定
 */
export async function getAudioVideoStream(deviceId?: string): Promise<MediaStream> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('このブラウザはカメラ/マイクAPIをサポートしていません。HTTPS接続またはlocalhostでのアクセスが必要です。');
  }

  const constraints: MediaStreamConstraints = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    },
    video: deviceId
      ? {
          deviceId: { exact: deviceId },
          width: { ideal: 640, max: 640 },
          height: { ideal: 480, max: 480 },
          frameRate: { ideal: 15, max: 15 }
        }
      : {
          facingMode: 'user',
          width: { ideal: 640, max: 640 },
          height: { ideal: 480, max: 480 },
          frameRate: { ideal: 15, max: 15 }
        }
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    return stream;
  } catch (error) {
    throw new Error(`カメラ/マイクへのアクセスに失敗しました: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * メディアストリームを停止
 */
export function stopMediaStream(stream: MediaStream | null): void {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
}

