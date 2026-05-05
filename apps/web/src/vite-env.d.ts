/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** アプリ共通の API タイムアウト（ミリ秒）。省略時は 120000 */
  readonly VITE_API_TIMEOUT_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
