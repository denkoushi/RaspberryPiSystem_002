import axios, { AxiosError, isAxiosError } from 'axios';

import { readProductionBuildConfig } from '../config/productionBuildConfig';
import { reportKioskApi } from '../features/kiosk/errorTelemetry';
import { readViteApiTimeoutMs } from '../lib/api-timeout-ms';
import {
  DEFAULT_CLIENT_KEY,
  ensureClientKeyStorageInitialized,
  resolveClientKey,
  setClientKeyToStorage
} from '../lib/client-key';

export { DEFAULT_CLIENT_KEY };

export const apiBase = readProductionBuildConfig().apiBaseUrl;
const wsBase = readProductionBuildConfig().wsBaseUrl;
const KIOSK_KEY_RESET_TS_KEY = 'kiosk-client-key-last-reset-at';
const KIOSK_KEY_RESET_COOLDOWN_MS = 30000;

export const api = axios.create({
  baseURL: apiBase,
  timeout: readViteApiTimeoutMs()
});

export function getResolvedClientKey() {
  return resolveClientKey({ allowDefaultFallback: true }).key;
}

export function setAuthToken(token?: string) {
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common['Authorization'];
  }
}

export function setClientKeyHeader(key?: string) {
  const resolvedKey = key && key.length > 0 ? key : resolveClientKey({ allowDefaultFallback: true }).key;
  if (resolvedKey.length > 0) {
    api.defaults.headers.common['x-client-key'] = resolvedKey;
  } else {
    delete api.defaults.headers.common['x-client-key'];
  }
}

const resetKioskClientKey = () => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem('kiosk-client-key');
  const defaultKey = resolveClientKey({ allowDefaultFallback: true }).key;
  if (defaultKey.length > 0) {
    setClientKeyToStorage(defaultKey);
  }
  setClientKeyHeader(defaultKey);

  // 同一セッションで短時間に401が続いた場合、リロードループを防ぐ。
  const now = Date.now();
  const lastResetAtRaw = window.sessionStorage.getItem(KIOSK_KEY_RESET_TS_KEY);
  const lastResetAt = lastResetAtRaw ? Number(lastResetAtRaw) : 0;
  window.sessionStorage.setItem(KIOSK_KEY_RESET_TS_KEY, String(now));

  if (window.location.pathname.startsWith('/kiosk')) {
    if (Number.isFinite(lastResetAt) && now - lastResetAt < KIOSK_KEY_RESET_COOLDOWN_MS) {
      return;
    }
    window.location.reload();
  }
};

// 初期読み込み時:
// - localStorage が未設定/空の場合のみデフォルトを設定（誤って他端末のキーを上書きしない）
// - 既に保存済みのキーがあればそれを適用する
// - Mac環境を検出して適切なデフォルト値を設定
// useLocalStorageとの互換性を保つため、JSON形式で保存する
if (typeof window !== 'undefined') {
  ensureClientKeyStorageInitialized();
  const resolved = resolveClientKey({ allowDefaultFallback: true }).key;
  setClientKeyHeader(resolved);
}

const requestStartedAt = new WeakMap<object, number>();

// すべてのリクエストで client-key を付与
api.interceptors.request.use((config) => {
  requestStartedAt.set(config, Date.now());
  const key = resolveClientKey({ allowDefaultFallback: true }).key;
  config.headers = config.headers ?? {};
  if (!config.headers['x-client-key'] && key.length > 0) {
    config.headers['x-client-key'] = key;
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    reportKioskApi({ method: response.config.method, url: response.config.url, status: response.status,
      streaming: response.config.responseType === 'stream' || String(response.headers['content-type'] ?? '').includes('text/event-stream'),
      durationMs: Date.now() - (requestStartedAt.get(response.config) ?? Date.now()) });
    return response;
  },
  (error: unknown) => {
    if (isAxiosError(error)) {
      const ax = error as AxiosError<{ code?: unknown; message?: unknown }>;
      reportKioskApi({ method: ax.config?.method, url: ax.config?.url, status: ax.response?.status,
        streaming: ax.config?.responseType === 'stream',
        code: ax.code, apiCode: (ax.response?.data as { errorCode?: unknown; code?: unknown })?.errorCode ?? ax.response?.data?.code,
        requestId: (ax.response?.data as { requestId?: unknown })?.requestId,
        durationMs: Date.now() - (ax.config ? requestStartedAt.get(ax.config) ?? Date.now() : Date.now()) });
      // axios: 請求タイムアウトは通常 ECONNABORTED を付与
      const isTimeout = ax.code === 'ECONNABORTED';
      if (isTimeout) {
        ax.message = 'リクエストがタイムアウトしました。ネットワークまたはサーバの負荷を確認してください。';
        (ax as AxiosError & { apiTimeout?: boolean }).apiTimeout = true;
      }
    }

    const status = isAxiosError(error) ? error.response?.status : undefined;
    const code =
      error && typeof error === 'object' && 'response' in error
        ? (error.response as { data?: { code?: unknown } } | undefined)?.data?.code
        : undefined;
    const message =
      error && typeof error === 'object' && 'response' in error
        ? (error.response as { data?: { message?: unknown } } | undefined)?.data?.message
        : undefined;

    const isInvalidClientKey =
      code === 'INVALID_CLIENT_KEY' ||
      code === 'CLIENT_KEY_INVALID' ||
      (typeof message === 'string' && message.includes('無効なクライアントキー')) ||
      (typeof message === 'string' && message.includes('Invalid client key'));
    if (status === 401 && isInvalidClientKey) {
      resetKioskClientKey();
    }
    return Promise.reject(error);
  }
);

export function getWebSocketUrl(path: string) {
  if (path.startsWith('ws')) return path;
  return `${wsBase}${path}`;
}
