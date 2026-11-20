const PHRASES = [
  'ご視聴ありがとうございました',
  'ご視聴いただきありがとうございました',
  'ご清聴ありがとうございました',
  'チャンネル登録',
  '次回もお楽しみに',
  '字幕作成',
  'Thank you for watching'
];
const EXACT = ['ありがとうございました', 'ありがとうございます', 'おやすみなさい', 'はい', 'ん', 'えー', 'あー'];

/** True for text Whisper commonly invents on silence or noise. */
export function isHallucination(text: string): boolean {
  const clean = text.replace(/\s+/gu, '');
  if (!clean) return true;
  if (!/[\p{L}\p{N}]/u.test(clean)) return true;
  if (PHRASES.some((p) => clean.toLowerCase().includes(p.replace(/\s+/gu, '').toLowerCase()))) return true;
  const bare = clean.replace(/[。、．，.,!！?？ー〜~…・]+/gu, '');
  if (EXACT.includes(bare)) return true;
  if (/^(.)\1{7,}$/u.test(bare)) return true;
  return false;
}
