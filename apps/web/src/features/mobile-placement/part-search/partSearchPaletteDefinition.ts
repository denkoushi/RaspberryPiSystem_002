/**
 * 文字パレットの定義（表示コンポーネントと剪定で同一の集合を参照する）。
 */
export const PART_SEARCH_PRESETS = ['脚', '足', 'テーブル', 'ボルト', 'アシ'] as const;

export const PART_SEARCH_GOJUON_ROWS: readonly (readonly string[])[] = [
  ['あ', 'い', 'う', 'え', 'お'],
  ['か', 'き', 'く', 'け', 'こ'],
  ['さ', 'し', 'す', 'せ', 'そ'],
  ['た', 'ち', 'つ', 'て', 'と'],
  ['な', 'に', 'ぬ', 'ね', 'の'],
  ['は', 'ひ', 'ふ', 'へ', 'ほ'],
  ['ま', 'み', 'む', 'め', 'も'],
  ['や', 'ゆ', 'よ'],
  ['ら', 'り', 'る', 'れ', 'ろ'],
  ['わ', 'を', 'ん']
];

export const PART_SEARCH_ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** 空白ボタンが挿入する文字（剪定のキーとしても使用） */
export const PART_SEARCH_SPACE_KEY = ' ';

export const PART_SEARCH_PALETTE_KEYS: readonly string[] = [
  ...PART_SEARCH_PRESETS,
  ...PART_SEARCH_GOJUON_ROWS.flat(),
  ...PART_SEARCH_ABC,
  PART_SEARCH_SPACE_KEY
];
