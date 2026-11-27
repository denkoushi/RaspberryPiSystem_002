/** 日本時間と UTC の差(ミリ秒)。 */
export const JST_OFFSET_MS = 9 * 3_600_000;

/** at を日本時間の日付にして、UTC 0時の Date で返す(@db.Date との比較用)。 */
export function toJstDate(at: Date): Date {
  const jst = new Date(at.getTime() + JST_OFFSET_MS);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
}
