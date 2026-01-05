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
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
    return stream;
  } catch (error) {
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

