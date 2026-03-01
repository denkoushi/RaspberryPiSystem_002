export type ClientKeySource = 'url' | 'storage' | 'props' | 'default';

export interface ResolveResult {
  key: string;
  source: ClientKeySource;
}

export interface ResolveOptions {
  /** デフォルトフォールバックを許可するか（電源操作時は false） */
  allowDefaultFallback?: boolean;
  /** 外部から渡されたキー（Props 等） */
  providedKey?: string;
}
