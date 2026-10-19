/**
 * 緊急表示のメッセージを画像にするための SVG（純関数）。
 * - メッセージのみ: 画面全体を赤地にして大きく出す
 * - PDF・持出一覧と一緒に出す: 上部に赤い帯を重ねる
 */

const EMERGENCY_RED = '#B91C1C';
const MAX_LINES = 5;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 全角を 1、半角を 0.55 として行の見かけの長さを見積もる */
function visualLength(line: string): number {
  let length = 0;
  for (const char of line) {
    length += (char.codePointAt(0) ?? 0) <= 0xff ? 0.55 : 1;
  }
  return length;
}

/** 改行を尊重しつつ、1 行が長すぎるときは折り返す */
export function wrapEmergencyMessage(message: string, maxCharsPerLine: number): string[] {
  const lines: string[] = [];
  for (const raw of message.split(/\r?\n/)) {
    const source = raw.trim();
    if (source === '') continue;
    let current = '';
    for (const char of source) {
      if (visualLength(current + char) > maxCharsPerLine) {
        lines.push(current);
        current = '';
      }
      current += char;
    }
    if (current !== '') lines.push(current);
  }
  if (lines.length > MAX_LINES) {
    const kept = lines.slice(0, MAX_LINES);
    kept[MAX_LINES - 1] = `${kept[MAX_LINES - 1].slice(0, -1)}…`;
    return kept;
  }
  return lines;
}

export function buildEmergencyMessageSvg(message: string, width: number, height: number): string {
  const scale = width / 1920;
  const lines = wrapEmergencyMessage(message, 16);
  const longest = Math.max(1, ...lines.map(visualLength));
  // 短い文ほど大きく。横幅と行数の両方に収まる大きさにする
  const byWidth = (width * 0.86) / longest;
  const byHeight = (height * 0.58) / (Math.max(1, lines.length) * 1.3);
  const fontSize = Math.round(Math.min(200 * scale, byWidth, byHeight));
  const lineHeight = Math.round(fontSize * 1.3);
  const blockHeight = lineHeight * lines.length;
  const firstBaseline = Math.round(height / 2 - blockHeight / 2 + fontSize * 0.9 + 30 * scale);
  const left = Math.round(96 * scale);
  const tspans = lines
    .map((line, index) => `<tspan x="${left}" y="${firstBaseline + index * lineHeight}">${escapeXml(line)}</tspan>`)
    .join('');
  return `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${EMERGENCY_RED}" />
      <text x="${left}" y="${Math.round(130 * scale)}" font-size="${Math.round(44 * scale)}" font-weight="700"
        fill="#ffffff" font-family="sans-serif" letter-spacing="${Math.round(10 * scale)}">お知らせ</text>
      <text font-size="${fontSize}" font-weight="700" fill="#ffffff" font-family="sans-serif">${tspans}</text>
    </svg>
  `;
}

/** 他のコンテンツの上に重ねる帯（高さは画面の約 13%） */
export function buildEmergencyBandSvg(message: string, width: number, height: number): string {
  const bandHeight = Math.round(height * 0.13);
  const line = wrapEmergencyMessage(message.replace(/\r?\n/g, '　'), 60)[0] ?? '';
  const fontSize = Math.round(Math.min(bandHeight * 0.52, (width * 0.94) / Math.max(1, visualLength(line))));
  return `
    <svg width="${width}" height="${bandHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${EMERGENCY_RED}" />
      <text x="${Math.round(width * 0.03)}" y="${Math.round(bandHeight / 2 + fontSize * 0.36)}" font-size="${fontSize}"
        font-weight="700" fill="#ffffff" font-family="sans-serif">${escapeXml(line)}</text>
    </svg>
  `;
}
