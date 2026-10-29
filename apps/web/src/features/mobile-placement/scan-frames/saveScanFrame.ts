import { createHaizenClientRecordId } from '../haizen/offline/haizenOfflineQueueStore';
import { requestSync } from '../sync/syncScheduler';

import { scanFrameStore, type ScanFrameRecord } from './scanFrameStore';

import type { ScanFrameCapture } from '../../barcode-scan/scanFrameCapture';

export function onScanIdle(work: () => Promise<void>) {
  const run = () => { void work().catch(() => console.warn('Scan frame could not be saved')); };
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 2000 });
  else window.setTimeout(run, 0);
}
const jpeg = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('JPEG encoding failed')), 'image/jpeg', 0.7);
});

export async function encodeScanFrame(capture: ScanFrameCapture) {
  const { fullCanvas, ...meta } = capture;
  const fullJpeg = await jpeg(fullCanvas);
  let cropJpeg: Blob | undefined;
  if (meta.cropBox) {
    const box = meta.cropBox;
    const sx = fullCanvas.width / Number(meta.camera.videoWidth);
    const sy = fullCanvas.height / Number(meta.camera.videoHeight);
    const padding = Math.max(16, Math.max(box.width, box.height) * 0.15);
    const x = Math.max(0, (box.x - padding) * sx);
    const y = Math.max(0, (box.y - padding) * sy);
    const width = Math.min(fullCanvas.width, (box.x + box.width + padding) * sx) - x;
    const height = Math.min(fullCanvas.height, (box.y + box.height + padding) * sy) - y;
    if (width > 0 && height > 0) {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 640 / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(fullCanvas, x, y, width, height, 0, 0, canvas.width, canvas.height);
        cropJpeg = await jpeg(canvas);
      }
    }
  }
  return { meta, fullJpeg, cropJpeg };
}
export type FrameDetails = Pick<ScanFrameRecord, 'kind' | 'clientRecordId' | 'shelfCodeRaw' | 'slipKind' | 'manualValue'>;
export function saveScanFrame(capture: ScanFrameCapture, details: FrameDetails): string {
  const id = createHaizenClientRecordId();
  onScanIdle(async () => {
    const encoded = await encodeScanFrame(capture);
    await scanFrameStore.put({ id, ...encoded, ...details, createdAt: capture.capturedAt });
    requestSync('scan-frame-saved');
  });
  return id;
}
