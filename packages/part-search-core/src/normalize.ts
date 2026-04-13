/**
 * 小書き・促音を通常サイズへ（濁点・半濁点・長音は変更しない）。
 * ひらがな/カタカナは {@link hiraganaToKatakana} でカタカナへ統一する。
 */
/** ひらがなの小書きのみ（カタカナ小書きは拗音・外来語表記を壊すため含めない）。 */
const SMALL_KANA_MAP: ReadonlyMap<string, string> = new Map([
  ['ぁ', 'あ'],
  ['ぃ', 'い'],
  ['ぅ', 'う'],
  ['ぇ', 'え'],
  ['ぉ', 'お'],
  ['ゃ', 'や'],
  ['ゅ', 'ゆ'],
  ['ょ', 'よ'],
  ['ゎ', 'わ'],
  ['ゕ', 'か'],
  ['ゖ', 'け']
]);

function mapSmallKanaToOrdinary(s: string): string {
  return [...s].map((ch) => SMALL_KANA_MAP.get(ch) ?? ch).join('');
}

/**
 * ひらがなの拗音（2文字）を対応するカタカナ1文字へ（検索の表記ゆれ吸収）。
 * 長いキーを先に置換する。
 */
const HIRAGANA_YOON_TO_KATAKANA: Record<string, string> = {
  きゃ: 'キャ',
  きゅ: 'キュ',
  きょ: 'キョ',
  ぎゃ: 'ギャ',
  ぎゅ: 'ギュ',
  ぎょ: 'ギョ',
  しゃ: 'シャ',
  しゅ: 'シュ',
  しょ: 'ショ',
  じゃ: 'ジャ',
  じゅ: 'ジュ',
  じょ: 'ジョ',
  ちゃ: 'チャ',
  ちゅ: 'チュ',
  ちょ: 'チョ',
  にゃ: 'ニャ',
  にゅ: 'ニュ',
  にょ: 'ニョ',
  ひゃ: 'ヒャ',
  ひゅ: 'ヒュ',
  ひょ: 'ヒョ',
  びゃ: 'ビャ',
  びゅ: 'ビュ',
  びょ: 'ビョ',
  ぴゃ: 'ピャ',
  ぴゅ: 'ピュ',
  ぴょ: 'ピョ',
  みゃ: 'ミャ',
  みゅ: 'ミュ',
  みょ: 'ミョ',
  りゃ: 'リャ',
  りゅ: 'リュ',
  りょ: 'リョ',
  ぢゃ: 'ヂャ',
  ぢゅ: 'ヂュ',
  ぢょ: 'ヂョ'
};

function replaceHiraganaYoonWithKatakana(s: string): string {
  const entries = Object.entries(HIRAGANA_YOON_TO_KATAKANA).sort((a, b) => b[0].length - a[0].length);
  let out = s;
  for (const [k, rep] of entries) {
    out = out.split(k).join(rep);
  }
  return out;
}

/** 促音（っ/ッ）を除去し、表記ゆれとして吸収する（語義は検索用途に限定）。 */
function removeSokuon(s: string): string {
  return s.replace(/っ/g, '').replace(/ッ/g, '');
}

/**
 * ひらがな（U+3041–U+3096）を対応するカタカナへ。
 */
export function hiraganaToKatakana(s: string): string {
  return [...s]
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      if (code >= 0x3041 && code <= 0x3096) {
        return String.fromCodePoint(code + 0x60);
      }
      return ch;
    })
    .join('');
}

/**
 * カタカナ（U+30A1–U+30F6）を対応するひらがなへ。
 */
export function katakanaToHiragana(s: string): string {
  return [...s]
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      if (code >= 0x30a1 && code <= 0x30f6) {
        return String.fromCodePoint(code - 0x60);
      }
      return ch;
    })
    .join('');
}

/**
 * 部品名検索用の正規化（表記ゆれ吸収の前処理）。
 * DB ILIKE とクライアント剪定で同一の前提にする。
 *
 * - Unicode NFKC
 * - trim
 * - 小書き・促音を通常文字へ
 * - ひらがなをカタカナへ統一（濁点・半濁点・長音は NFKC のまま区別）
 */
export function normalizePartSearchQuery(input: string): string {
  let s = input.normalize('NFKC').trim();
  s = replaceHiraganaYoonWithKatakana(s);
  s = mapSmallKanaToOrdinary(s);
  s = removeSokuon(s);
  s = hiraganaToKatakana(s);
  return s;
}

/**
 * ILIKE 用に、正規化済みトークンを DB 側のひらがな/カタカナ混在に合わせて展開する。
 * （正規化カタカナと、そのひらがな版の両方で部分一致させる）
 */
export function partSearchTermVariantsForIlike(term: string): string[] {
  const n = normalizePartSearchQuery(term);
  if (n.length === 0) {
    return [];
  }
  const h = katakanaToHiragana(n);
  if (h === n) {
    return [n];
  }
  return [...new Set([n, h])];
}

/**
 * 全角英数字→半角・全角スペース→半角スペース・ASCII は大文字化。
 * 先に {@link normalizePartSearchQuery} でかなを統一する（登録製番ボタン下段の機種名と整合）。
 */
export function normalizeMachineNameForPartSearch(value: string | null | undefined): string {
  if (value == null) {
    return '';
  }
  const kanaUnified = normalizePartSearchQuery(String(value).trim());
  const half = kanaUnified
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.codePointAt(0)! - 0xfee0))
    .replace(/\u3000/g, ' ');
  return half.toUpperCase();
}
