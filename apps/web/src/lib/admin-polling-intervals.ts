/**
 * 管理画面・Pi 向けポーリング間隔の既定値（ミリ秒）。
 * コード内の魔法数字をまとめ、用途別に段階緩和しやすくする。
 */
export const POLL_MS = {
  /** メンテナンス状態（deploy-status）。従来 5s から緩和。 */
  deployStatus: 8000,
  /** システム負荷・温度ヘッダ等 */
  systemInfo: 15000,
  /** サイネージレンダリング進捗 */
  signageRenderStatus: 15000,
  /** DGX 運用コンソール（複数クエリ並走時の頻度を抑える） */
  dgxResourceDashboardPrimary: 8000
} as const;
