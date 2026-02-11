/**
 * カメラ撮影ユーティリティ
 * 
 * ブラウザのカメラAPIを使用して写真を撮影し、100KB程度に圧縮してBase64エンコードする。
 */

/**
 * カメラストリームを取得する
 * @param deviceId カメラデバイスID（省略時はデフォルトカメラ）
 * @returns MediaStream
 */
export async function getCameraStream(deviceId?: string): Promise<MediaStream> {
  // navigator.mediaDevicesの存在確認
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('このブラウザはカメラAPIをサポートしていません。HTTPS接続またはlocalhostでのアクセスが必要です。');
  }

  const constraints: MediaStreamConstraints = {
    video: deviceId
      ? { 
          deviceId: { exact: deviceId },
          width: { ideal: 640, max: 640 }, // ラズパイ4の処理能力を考慮して640x480に制限
          height: { ideal: 480, max: 480 },
          frameRate: { ideal: 15, max: 15 } // フレームレートを15fpsに制限（負荷削減）
        }
      : { 
          facingMode: 'environment', 
          width: { ideal: 640, max: 640 }, // ラズパイ4の処理能力を考慮して640x480に制限
          height: { ideal: 480, max: 480 },
          frameRate: { ideal: 15, max: 15 } // フレームレートを15fpsに制限（負荷削減）
        },
    audio: false,
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    return stream;
  } catch (error) {
    throw new Error(`カメラへのアクセスに失敗しました: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * カメラストリームから写真を撮影する
 * @param stream MediaStream
 * @returns 撮影した画像のBlob（JPEG形式）
 */
const DEFAULT_MIN_FRAME_BRIGHTNESS = 0.1; // 0-255 スケール（暗めでも撮影を許容する）

function resolveMinFrameBrightness(): number {
  // ビルド時環境変数（Vite）で上書き可能にする
  // 例: VITE_CAMERA_MIN_FRAME_BRIGHTNESS=8
  const env = import.meta.env as Record<string, string | undefined>;
  const raw = env.VITE_CAMERA_MIN_FRAME_BRIGHTNESS;
  if (raw === undefined || raw === null || raw === '') {
    return DEFAULT_MIN_FRAME_BRIGHTNESS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_MIN_FRAME_BRIGHTNESS;
  }
  return Math.min(255, Math.max(0, parsed));
}

function calculateAverageLuminance(imageData: ImageData): number {
  const { data } = imageData;
  let sum = 0;
  const pixelCount = imageData.width * imageData.height;
  for (let i = 0; i < data.length; i += 4) {
    // 標準的な輝度近似式（Rec. 601）
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    sum += 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return sum / pixelCount;
}

export async function capturePhotoFromStream(stream: MediaStream): Promise<Blob> {
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.style.position = 'fixed';
  video.style.top = '-9999px';
  video.style.left = '-9999px';
  video.style.width = '1px';
  video.style.height = '1px';
  video.style.opacity = '0';
  video.style.pointerEvents = 'none';
  
  // DOMに追加してブラウザの最適化を有効にする
  document.body.appendChild(video);
  
  try {
    video.srcObject = stream;
    
    // メタデータが読み込まれるまで待機
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('ビデオメタデータの読み込みがタイムアウトしました'));
      }, 5000); // 5秒でタイムアウト
      
      video.onloadedmetadata = () => {
        clearTimeout(timeout);
        resolve();
      };
      
      video.onerror = (error) => {
        clearTimeout(timeout);
        reject(new Error(`ビデオの読み込みに失敗しました: ${error}`));
      };
    });
    
    // ビデオを再生
    await video.play();
    
    // フレームが安定するまで少し待機（100ms）
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvasコンテキストの取得に失敗しました');
    }

    // ビデオフレームをキャンバスに描画
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // フレームの平均輝度を計算し、極端に暗い場合は再撮影を促す
    const frameData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const averageLuma = calculateAverageLuminance(frameData);
    const minFrameBrightness = resolveMinFrameBrightness();
    if (averageLuma < minFrameBrightness) {
      throw new Error('写真が暗すぎます。明るい場所でもう一度撮影してください。');
    }

    // JPEG形式でBlobに変換（品質80%）
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('画像の変換に失敗しました'));
          }
        },
        'image/jpeg',
        0.8
      );
    });
  } finally {
    // クリーンアップ：ビデオを停止してDOMから削除
    video.pause();
    video.srcObject = null;
    if (video.parentNode) {
      video.parentNode.removeChild(video);
    }
  }
}

/**
 * 画像を100KB程度に圧縮する
 * @param blob 元の画像Blob
 * @param maxSizeKB 最大サイズ（KB、デフォルト: 100）
 * @returns 圧縮された画像のBlob
 */
export async function compressImage(blob: Blob, maxSizeKB: number = 100): Promise<Blob> {
  const maxSizeBytes = maxSizeKB * 1024;

  // 既に目標サイズ以下の場合はそのまま返す
  if (blob.size <= maxSizeBytes) {
    return blob;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      // 640x480px以下になるようにリサイズ（ラズパイ4の処理能力を考慮）
      const maxWidth = 640;
      const maxHeight = 480;
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.floor(width * ratio);
        height = Math.floor(height * ratio);
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvasコンテキストの取得に失敗しました'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      // 品質を下げながら圧縮（100KB以下になるまで）
      const quality = 0.8;
      const minQuality = 0.5;
      const step = 0.1;

      const tryCompress = (currentQuality: number) => {
        canvas.toBlob(
          (compressedBlob) => {
            if (!compressedBlob) {
              reject(new Error('画像の圧縮に失敗しました'));
              return;
            }

            if (compressedBlob.size <= maxSizeBytes || currentQuality <= minQuality) {
              resolve(compressedBlob);
            } else {
              tryCompress(currentQuality - step);
            }
          },
          'image/jpeg',
          currentQuality
        );
      };

      tryCompress(quality);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('画像の読み込みに失敗しました'));
    };

    img.src = url;
  });
}

/**
 * BlobをBase64エンコードされた文字列に変換する
 * @param blob 画像Blob
 * @returns Base64エンコードされた文字列（data:image/jpeg;base64,プレフィックスなし）
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // data:image/jpeg;base64,プレフィックスを除去
      const base64 = result.split(',')[1];
      if (base64) {
        resolve(base64);
      } else {
        reject(new Error('Base64エンコードに失敗しました'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * カメラから写真を撮影し、100KB程度に圧縮してBase64エンコードする
 * @param deviceId カメラデバイスID（省略時はデフォルトカメラ）
 * @returns Base64エンコードされたJPEG画像データ（プレフィックスなし）
 */
export async function captureAndCompressPhoto(deviceId?: string): Promise<string> {
  const stream = await getCameraStream(deviceId);
  try {
    const photoBlob = await capturePhotoFromStream(stream);
    const compressedBlob = await compressImage(photoBlob, 100);
    const base64 = await blobToBase64(compressedBlob);
    return base64;
  } finally {
    // ストリームを停止
    stream.getTracks().forEach((track) => track.stop());
  }
}

/**
 * カメラストリームを取得してプレビュー用のvideo要素に設定する
 * @param videoElement video要素
 * @param deviceId カメラデバイスID（省略時はデフォルトカメラ）
 * @returns MediaStream（クリーンアップ用）
 */
export async function startCameraPreview(
  videoElement: HTMLVideoElement,
  deviceId?: string
): Promise<MediaStream> {
  // navigator.mediaDevicesの存在確認
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('このブラウザはカメラAPIをサポートしていません。HTTPS接続またはlocalhostでのアクセスが必要です。');
  }

  const constraints: MediaStreamConstraints = {
    video: deviceId
      ? { 
          deviceId: { exact: deviceId },
          width: { ideal: 640, max: 640 }, // ラズパイ4の処理能力を考慮して640x480に制限
          height: { ideal: 480, max: 480 },
          frameRate: { ideal: 15, max: 15 } // フレームレートを15fpsに制限（負荷削減）
        }
      : { 
          facingMode: 'environment', 
          width: { ideal: 640, max: 640 }, // ラズパイ4の処理能力を考慮して640x480に制限
          height: { ideal: 480, max: 480 },
          frameRate: { ideal: 15, max: 15 } // フレームレートを15fpsに制限（負荷削減）
        },
    audio: false,
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = stream;
    await videoElement.play();
    return stream;
  } catch (error) {
    throw new Error(`カメラへのアクセスに失敗しました: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * カメラストリームを停止する
 * @param stream MediaStream
 */
export function stopCameraStream(stream: MediaStream | null): void {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
}

