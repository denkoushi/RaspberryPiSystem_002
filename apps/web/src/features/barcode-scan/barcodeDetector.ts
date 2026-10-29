import { BarcodeFormat } from '@zxing/library';

// Local structural types: lib.dom does not currently declare Shape Detection.
export interface NativeBarcode {
  boundingBox?: { x: number; y: number; width: number; height: number };
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

const nativeFormatNames: Partial<Record<BarcodeFormat, string>> = {
  [BarcodeFormat.CODE_128]: 'code_128',
  [BarcodeFormat.CODE_39]: 'code_39',
  [BarcodeFormat.CODE_93]: 'code_93',
  [BarcodeFormat.CODABAR]: 'codabar',
  [BarcodeFormat.ITF]: 'itf',
  [BarcodeFormat.EAN_13]: 'ean_13',
  [BarcodeFormat.EAN_8]: 'ean_8',
  [BarcodeFormat.UPC_A]: 'upc_a',
  [BarcodeFormat.UPC_E]: 'upc_e',
};

export async function createNativeBarcodeDetector(formats: BarcodeFormat[]): Promise<NativeBarcodeDetector | null> {
  try {
    const Detector = getBarcodeDetector();
    if (!Detector || formats.length === 0) return null;
    const supported = await Detector.getSupportedFormats();
    const names = formats.map((format) => nativeFormatNames[format]);
    if (!names.every((name): name is string => name !== undefined && supported.includes(name))) return null;
    return new Detector({ formats: names });
  } catch {
    return null;
  }
}
