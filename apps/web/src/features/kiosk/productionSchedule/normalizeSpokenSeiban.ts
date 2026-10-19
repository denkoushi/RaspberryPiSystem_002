const readings: Record<string, string> = {
  ぜろ: '0', れい: '0', まる: '0', いち: '1', にー: '2', に: '2', さん: '3',
  よん: '4', し: '4', ごー: '5', ご: '5', ろく: '6', なな: '7', しち: '7',
  はち: '8', きゅう: '9', く: '9', じゅう: '十', ひゃく: '百', せん: '千'
};
const readingPattern = new RegExp(Object.keys(readings).sort((a, b) => b.length - a.length).join('|'), 'g');
const kanjiDigits = '〇一二三四五六七八九';
const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

// Unit notation is deliberately limited to descending 千・百・十 with one digit per place.
function normalizeNumber(value: string): string {
  if (!/[十百千]/.test(value)) return value;
  if (!/^(?:[1-9]?千)?(?:[1-9]?百)?(?:[1-9]?十)?[1-9]?$/.test(value)) return value;
  let total = 0;
  let digit = 0;
  for (const char of value) {
    if (units[char]) { total += (digit || 1) * units[char]; digit = 0; }
    else digit = Number(char);
  }
  return String(total + digit);
}

export function normalizeSpokenSeiban(transcript: string): string | null {
  const result = transcript
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .replace(/[\s、。,.]/g, '')
    .replace(/はいふん|まいなす|の|[−‐]/g, '-')
    .replace(readingPattern, reading => readings[reading])
    .replace(/[〇零一二三四五六七八九]/g, char => char === '零' ? '0' : String(kanjiDigits.indexOf(char)))
    .replace(/[0-9十百千]+/g, normalizeNumber)
    .replace(/([0-9])ー(?=[0-9])/g, '$1-')
    .toUpperCase();
  return /^[A-Z0-9-]+$/.test(result) && /[0-9]/.test(result) ? result : null;
}
