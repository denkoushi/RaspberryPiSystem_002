export type NfcStreamPolicy = 'disabled' | 'localOnly' | 'legacy';

const KIOSK_CLIENT_KEY_STORAGE_KEY = 'kiosk-client-key';

const isBrowser = typeof window !== 'undefined';

const isMacUserAgent = (ua: string) => /Macintosh|Mac OS X/i.test(ua);

const readKioskClientKeyFromLocalStorage = (): string | null => {
  if (!isBrowser) return null;
  const raw = window.localStorage.getItem(KIOSK_CLIENT_KEY_STORAGE_KEY);
  if (!raw || raw.length === 0) return null;
  // `apps/web/src/api/client.ts` と互換のため、JSON文字列を優先して解釈する。
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'string' && parsed.length > 0 ? parsed : raw;
  } catch {
    return raw;
  }
};

/**
 * NFC入力のスコープ（端末分離）を決めるポリシーを解決する。
 *
 * 方針:
 * - 運用MacではNFCを常に無効化（誤発火/横漏れを起こさない）
 * - kiosk端末（Pi4）は localOnly（localhostのNFC Agentのみ）を基本にする
 * - 互換のため legacy も残す（主に開発/過去挙動向け）
 */
export const resolveNfcStreamPolicy = (): NfcStreamPolicy => {
  if (!isBrowser) return 'legacy';

  const ua = window.navigator.userAgent ?? '';
  const storedClientKey = readKioskClientKeyFromLocalStorage();

  // 要件: MacでキオスクUIを開いてもNFCは無効
  if (isMacUserAgent(ua)) return 'disabled';
  if (storedClientKey && storedClientKey.startsWith('client-key-mac-')) return 'disabled';

  const mode = String(import.meta.env.VITE_AGENT_WS_MODE ?? '').toLowerCase();
  if (mode === 'local') return 'localOnly';

  return 'legacy';
};

