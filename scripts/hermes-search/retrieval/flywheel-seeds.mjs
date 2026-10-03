// Seeds for synthetic questions (docs/plans/hermes-synthetic-question-flywheel-execplan.md).
// A seed fixes what one generated question asks about (intent), how it is written (style), and
// who asks it (role). Seeds come from these lists, not from people, so the set grows without
// anyone writing test questions. Real users write short, urgent questions, so the style mix
// leans terse.

export const INTENTS = [
  { id: 'phenomenon', label: '何が起きたか（現象）', fields: ['remarks', 'condition'] },
  { id: 'cause', label: 'なぜ起きたか（原因）', fields: ['condition'] },
  { id: 'countermeasure', label: 'どう再発を防いだか（是正・対策）', fields: ['correctiveContent'] },
  { id: 'disposition', label: '現品をどう処置したか（処置）', fields: ['disposition'] },
  { id: 'similar', label: '同じような不適合が過去にあったか（類似事例）', fields: ['remarks', 'condition'] },
];

export const STYLES = [
  { id: 'terse', weight: 50, instruction: '2〜6語の短い言い方。助詞を省いてよい。例の型: 「〇〇 △△ 不適合」' },
  { id: 'colloquial', weight: 20, instruction: '現場で口頭で聞くような話し言葉。例の型: 「〇〇したやつって前にもあった？」' },
  { id: 'kana', weight: 15, instruction: '漢字の一部をひらがなやカタカナで書く。例の型: 「さび」「キズ」「はがれ」' },
  { id: 'typo', weight: 15, instruction: '急いで打ったような軽い誤字や変換ミスを1つ含める。' },
];

export const ROLES = [
  { id: 'worker', label: '組立や加工の作業者' },
  { id: 'inspector', label: '検査員' },
  { id: 'designer', label: '設計者' },
  { id: 'quality', label: '品質保証の担当者' },
];

/** Small deterministic random generator (mulberry32), so a fixed seed repeats the same set. */
export function createRandom(seed = 1) {
  let state = (Number(seed) >>> 0) || 1;
  return function random() {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickWeighted(items, random) {
  const total = items.reduce((sum, item) => sum + (item.weight ?? 1), 0);
  let point = random() * total;
  for (const item of items) {
    point -= item.weight ?? 1;
    if (point < 0) return item;
  }
  return items[items.length - 1];
}

function pickOne(items, random) {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

/**
 * Seeds for `count` questions. `allowedIntents` limits the intents to those the record can
 * answer (a record with no disposition text cannot anchor a disposition question).
 */
export function sampleSeed({ random, allowedIntents = INTENTS.map((intent) => intent.id) }) {
  const intents = INTENTS.filter((intent) => allowedIntents.includes(intent.id));
  if (!intents.length) return null;
  return {
    intent: pickOne(intents, random).id,
    style: pickWeighted(STYLES, random).id,
    role: pickOne(ROLES, random).id,
  };
}

export function sampleSeeds({ count, random }) {
  return Array.from({ length: count }, () => sampleSeed({ random }));
}
