export type HaizenNativeScanResult =
  | { status: 'ok'; fseiban: string; tokens: string[]; text: string }
  | { status: 'cancelled' };

declare global {
  interface Window {
    HaizenNative?: { isAvailable(): boolean; scanFseiban(): void };
    __haizenNativeScanResult?: (result: HaizenNativeScanResult) => void;
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
