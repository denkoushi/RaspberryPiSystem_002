/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** アプリ共通の API タイムアウト（ミリ秒）。省略時は 120000 */
  readonly VITE_API_TIMEOUT_MS?: string;
  /** Immutable lowercase Git SHA compiled into a release Web bundle. */
  readonly VITE_RELEASE_SHA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
