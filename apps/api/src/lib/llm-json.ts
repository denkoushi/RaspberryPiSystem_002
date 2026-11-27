import { stripJsonFence } from './strip-json-fence.js';

/** AI の答えから JSON のオブジェクトを取り出す。前後に説明や ``` が付いていてもよい。読めなければ null。 */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const text = stripJsonFence(raw);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const data: unknown = JSON.parse(text.slice(start, end + 1));
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 配列から文字列だけを trim して取り出し、空を除いて max 件までにする。配列でなければ空。 */
export function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, max);
}
