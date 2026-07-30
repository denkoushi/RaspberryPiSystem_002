/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AGENT_WS_MODE?: string;
  readonly VITE_AGENT_WS_URL?: string;
  readonly VITE_API_BASE_URL?: string;
  /** アプリ共通の API タイムアウト（ミリ秒）。省略時は 120000 */
  readonly VITE_API_TIMEOUT_MS?: string;
  readonly VITE_BARCODE_AGENT_WS_URL?: string;
  readonly VITE_DEFAULT_CLIENT_KEY?: string;
  readonly VITE_ENABLE_DEBUG_LOGS?: string;
  readonly VITE_KIOSK_DUE_MGMT_LAYOUT_V2_ENABLED?: string;
  readonly VITE_KIOSK_LEADERBOARD_BOARD_CLIENT_PERF_LOG?: string;
  readonly VITE_KIOSK_LEADERBOARD_CACHE_WRITE_ON_MUTATION?: string;
  readonly VITE_KIOSK_LEADERBOARD_DEFER_RESIDUAL_SUMMARY_ENABLED?: string;
  readonly VITE_KIOSK_LEADERBOARD_SEIBAN_OR_CLIENT_FILTER?: string;
  readonly VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_ENABLED?: string;
  readonly VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_PHASE2_SWR?: string;
  readonly VITE_KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED?: string;
  readonly VITE_KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED?: string;
  /** Immutable lowercase Git SHA compiled into a release Web bundle. */
  readonly VITE_RELEASE_SHA?: string;
  /** Draft kiosk SOP popup. Production defaults to disabled until copy sign-off. */
  readonly VITE_KIOSK_SOP_POPUP_ENABLED?: string;
  readonly VITE_KIOSK_TARGET_LOCATION_SELECTOR_ENABLED?: string;
  readonly VITE_WS_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
