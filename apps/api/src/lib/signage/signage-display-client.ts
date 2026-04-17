/**
 * サイネージ表示端末の候補判定（フロントの `isSignageDisplayClientDevice` と同規約）。
 * `ClientDevice` に役割列が無い間は `apiKey` に `signage` を含むかで絞る。
 */
export function isSignageDisplayClientDeviceApiKey(apiKey: string): boolean {
  return apiKey.toLowerCase().includes('signage');
}
