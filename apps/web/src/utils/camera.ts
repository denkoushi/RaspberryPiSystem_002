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
      ? { deviceId: { exact: deviceId } }
      : { facingMode: 'environment' }, // 背面カメラを優先
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
export function capturePhotoFromStream(stream: MediaStream): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.play();

    video.onloadedmetadata = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvasコンテキストの取得に失敗しました'));
        return;
      }

      // ビデオフレームをキャンバスに描画
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // JPEG形式でBlobに変換（品質80%）
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
    };

    video.onerror = (error) => {
      reject(new Error(`ビデオの読み込みに失敗しました: ${error}`));
    };
  });
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

      // 800x600px以下になるようにリサイズ
      const maxWidth = 800;
      const maxHeight = 600;
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
      let quality = 0.8;
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
      ? { deviceId: { exact: deviceId } }
      : { facingMode: 'environment', width: { ideal: 800 }, height: { ideal: 600 } }, // 背面カメラを優先、解像度を指定
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

