/**
 * レート制限設定の統一的な管理
 * 
 * エンドポイントごとのレート制限設定を定義します。
 * ダッシュボードや履歴ページなど、頻繁にアクセスされるエンドポイントは
 * レート制限を除外するか、緩和する設定を適用します。
 */

export interface RateLimitConfig {
  /** レート制限をスキップするか */
  skip?: boolean;
  /** 最大リクエスト数（skipがtrueの場合は無視） */
  max?: number;
  /** 時間ウィンドウ（skipがtrueの場合は無視） */
  timeWindow?: string;
}

/**
 * エンドポイントパスとレート制限設定のマッピング
 * 
 * パスは完全一致またはプレフィックスマッチで判定されます。
 * より具体的なパスが優先されます。
 */
export const rateLimitConfigs: Record<string, RateLimitConfig> = {
  // ダッシュボードで使用されるエンドポイント（レート制限を除外）
  '/api/tools/employees': { skip: true },
  '/api/tools/items': { skip: true },
  '/api/tools/loans/active': { skip: true },
  
  // 履歴ページで使用されるエンドポイント（レート制限を除外）
  '/api/tools/transactions': { skip: true },
  
  // キオスクエンドポイント（レート制限を除外）
  '/api/kiosk': { skip: true },
  '/api/tools/loans/borrow': { skip: true },
  '/api/tools/loans/return': { skip: true },
  
  // インポートエンドポイント（レート制限を除外）
  '/api/imports': { skip: true },
  
  // 削除エンドポイント（レート制限を除外）- 既に上で定義済み
  '/api/tools/employees/:id': { skip: true },
  '/api/tools/items/:id': { skip: true },
};

/**
 * リクエストのパスに基づいてレート制限設定を取得
 * 
 * @param path リクエストパス（例: '/api/tools/employees'）
 * @returns レート制限設定、見つからない場合はundefined
 */
export function getRateLimitConfig(path: string): RateLimitConfig | undefined {
  // 完全一致を優先
  if (rateLimitConfigs[path]) {
    return rateLimitConfigs[path];
  }
  
  // プレフィックスマッチ
  for (const [configPath, config] of Object.entries(rateLimitConfigs)) {
    if (path.startsWith(configPath)) {
      return config;
    }
  }
  
  return undefined;
}

/**
 * リクエストのパスに基づいてレート制限をスキップするか判定
 * 
 * @param path リクエストパス
 * @returns スキップする場合はtrue
 */
export function shouldSkipRateLimit(path: string): boolean {
  const config = getRateLimitConfig(path);
  return config?.skip === true;
}

