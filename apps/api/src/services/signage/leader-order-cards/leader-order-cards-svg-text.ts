/**
 * SVG テキスト用の最小ユーティリティ（他レンダラと共有しないため leader-order 配下に閉じる）。
 */

export function escapeXmlForSvg(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function truncateChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= 1) {
    return '…';
  }
  return `${value.slice(0, maxChars - 1)}…`;
}
