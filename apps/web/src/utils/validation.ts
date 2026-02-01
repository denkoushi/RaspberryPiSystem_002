/**
 * バリデーション関数
 */

/**
 * APIキーの形式をチェック
 * @param apiKey チェックするAPIキー
 * @returns 有効な場合はtrue、無効な場合はfalse
 */
export function isValidApiKey(apiKey: string): boolean {
  if (!apiKey || typeof apiKey !== 'string') {
    return false;
  }

  // 最小長・最大長チェック
  if (apiKey.length < 8 || apiKey.length > 100) {
    return false;
  }

  // 許可文字チェック: 英数字、ハイフン、アンダースコア
  const validPattern = /^[a-zA-Z0-9_-]+$/;
  if (!validPattern.test(apiKey)) {
    return false;
  }

  return true;
}

/**
 * UUID v4形式をチェック
 * @param uuid チェックするUUID
 * @returns 有効な場合はtrue、無効な場合はfalse（空文字列も有効）
 */
export function isValidUuid(uuid: string): boolean {
  if (!uuid || uuid.length === 0) {
    return true; // 空文字列は有効（オプショナル）
  }

  // UUID v4形式の正規表現
  const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidV4Pattern.test(uuid);
}

/**
 * APIキーを検証し、無効な場合はデフォルト値を返す
 * @param apiKey 検証するAPIキー
 * @param defaultValue 無効な場合のデフォルト値
 * @returns 有効なAPIキーまたはデフォルト値
 */
export function validateAndSanitizeApiKey(apiKey: string | null | undefined, defaultValue: string): string {
  if (!apiKey || typeof apiKey !== 'string') {
    return defaultValue;
  }

  if (!isValidApiKey(apiKey)) {
    // 開発環境でのみ警告を出力
    if (import.meta.env.DEV) {
      console.warn(`[Validation] Invalid API key format detected: "${apiKey}". Using default: "${defaultValue}"`);
    }
    return defaultValue;
  }

  return apiKey;
}

/**
 * UUIDを検証し、無効な場合は空文字列を返す
 * @param uuid 検証するUUID
 * @returns 有効なUUIDまたは空文字列
 */
export function validateAndSanitizeUuid(uuid: string | null | undefined): string {
  if (!uuid || typeof uuid !== 'string') {
    return '';
  }

  if (!isValidUuid(uuid)) {
    // 開発環境でのみ警告を出力
    if (import.meta.env.DEV) {
      console.warn(`[Validation] Invalid UUID format detected: "${uuid}". Using empty string.`);
    }
    return '';
  }

  return uuid;
}
