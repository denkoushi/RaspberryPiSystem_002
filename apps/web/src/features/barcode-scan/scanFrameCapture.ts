export type ScanCropBox = { x: number; y: number; width: number; height: number };
export type ScanFrameCapture = {
  outcome: 'decoded' | 'timeout';
  decodedValue: string | null;
  decodeMs: number;
  retryCount: number;
  engine: 'native' | 'zxing';
  camera: Record<string, unknown>;
  torchOn?: boolean;
  zoom?: number;
  cropBox: ScanCropBox | null;
  capturedAt: string;
  fullCanvas: HTMLCanvasElement;
};

// Read only opt-in session metadata; never retain deviceId/groupId.
export function readScanCamera(stream: MediaStream): Record<string, unknown> {
  const track = stream.getVideoTracks()[0];
  if (!track) return {};
  const settings = track.getSettings() as Record<string, unknown>;
  const camera: Record<string, unknown> = {};
  for (const key of ['width', 'height', 'aspectRatio', 'frameRate', 'facingMode', 'focusMode', 'focusDistance', 'zoom', 'torch', 'exposureMode', 'exposureTime', 'whiteBalanceMode', 'colorTemperature']) {
    if (settings[key] !== undefined) camera[key] = settings[key];
  }
  const capabilities = track.getCapabilities?.() as Record<string, unknown> | undefined;
  camera.capabilities = { zoom: capabilities?.zoom, torch: capabilities?.torch };
  return camera;
}

export function captureScanFrame(video: HTMLVideoElement, meta: Omit<ScanFrameCapture, 'fullCanvas' | 'capturedAt'>): ScanFrameCapture | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  fullCanvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = fullCanvas.getContext('2d');
  if (!context) return null;
  context.drawImage(video, 0, 0, fullCanvas.width, fullCanvas.height);
  return { ...meta, camera: { ...meta.camera, videoWidth: video.videoWidth, videoHeight: video.videoHeight }, fullCanvas, capturedAt: new Date().toISOString() };
}

export function resultPointsBox(points: { getX(): number; getY(): number }[]): ScanCropBox | null {
  if (!points.length) return null;
  const xs = points.map((point) => point.getX());
  const ys = points.map((point) => point.getY());
  if (![...xs, ...ys].every(Number.isFinite)) return null;
  // Linear barcode readers often return two points on the same scan line.
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}
