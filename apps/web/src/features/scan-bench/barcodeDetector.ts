// Local structural types: lib.dom does not currently declare Shape Detection.
export interface NativeBarcode {
  rawValue: string;
  format: string;
}

export interface NativeBarcodeDetector {
  detect(source: HTMLVideoElement): Promise<NativeBarcode[]>;
}

export interface NativeBarcodeDetectorConstructor {
  new (options: { formats: string[] }): NativeBarcodeDetector;
  getSupportedFormats(): Promise<string[]>;
}

export function getBarcodeDetector(): NativeBarcodeDetectorConstructor | undefined {
  return (globalThis as typeof globalThis & {
    BarcodeDetector?: NativeBarcodeDetectorConstructor;
  }).BarcodeDetector;
}
