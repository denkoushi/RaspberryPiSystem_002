export type HaizenNativeScanResult =
  | { status: 'ok'; fseiban: string; tokens: string[]; text: string }
  | { status: 'cancelled' };

export type HaizenNativeSpeechResult =
  | { status: 'ok'; texts: string[] }
  | { status: 'cancelled' };

type HaizenNative = {
  isAvailable(): boolean;
  scanFseiban(): void;
  isSpeechAvailable?(): boolean;
  startSpeech?(): void;
  stopSpeech?(): void;
  setClientKey?(key: string): void;
};

declare global {
  interface Window {
    HaizenNative?: HaizenNative;
    __haizenNativeScanResult?: (result: HaizenNativeScanResult) => void;
    __haizenNativeSpeechResult?: (result: HaizenNativeSpeechResult) => void;
  }
}

export function isHaizenSpeechAvailable(): boolean {
  try {
    return typeof window !== 'undefined' &&
      typeof window.HaizenNative?.startSpeech === 'function' &&
      typeof window.HaizenNative.stopSpeech === 'function' &&
      window.HaizenNative.isSpeechAvailable?.() === true;
  } catch {
    return false;
  }
}

export function recognizeSpeechNative(): Promise<HaizenNativeSpeechResult> {
  if (pending) return Promise.reject(new Error('読取は既に実行中です'));
  if (!isHaizenSpeechAvailable()) return Promise.reject(new Error('端末の音声機能を利用できません'));
  return new Promise((resolve, reject) => {
    pending = true;
    const cleanup = () => {
      pending = false;
      if (window.__haizenNativeSpeechResult === onResult) delete window.__haizenNativeSpeechResult;
    };
    const onResult = (result: HaizenNativeSpeechResult) => {
      cleanup();
      resolve(result);
    };
    window.__haizenNativeSpeechResult = onResult;
    try {
      window.HaizenNative!.startSpeech!();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export function stopSpeechNative(): void {
  if (typeof window === 'undefined' || !window.__haizenNativeSpeechResult) return;
  try {
    window.HaizenNative?.stopSpeech?.();
  } catch {
    window.__haizenNativeSpeechResult?.({ status: 'cancelled' });
  }
}

let pending = false;

export function isHaizenNativeAvailable(): boolean {
  try {
    return typeof window !== 'undefined' &&
      typeof window.HaizenNative?.scanFseiban === 'function' &&
      window.HaizenNative.isAvailable();
  } catch {
    return false;
  }
}

export function scanFseibanNative(): Promise<HaizenNativeScanResult> {
  if (pending) return Promise.reject(new Error('読取は既に実行中です'));
  if (!isHaizenNativeAvailable()) return Promise.reject(new Error('端末の読取機能を利用できません'));
  return new Promise((resolve, reject) => {
    pending = true;
    const cleanup = () => {
      pending = false;
      if (window.__haizenNativeScanResult === onResult) delete window.__haizenNativeScanResult;
    };
    const onResult = (result: HaizenNativeScanResult) => {
      cleanup();
      resolve(result);
    };
    window.__haizenNativeScanResult = onResult;
    try {
      window.HaizenNative!.scanFseiban();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
