import { createHash } from 'node:crypto';

export const CAUSE_CATEGORIES = Object.freeze([
  { id: 'check', label: '確認・検査の漏れ', description: '確認不足、見落とし、検査漏れ、検図漏れ、チェック漏れなど、確認や検査を行わなかった、または見落とした。' },
  { id: 'assume', label: '思い込み・勘違い', description: '思い込み、勘違い、見間違い、誤認など、確認はしたが誤って認識した。' },
  { id: 'drawing', label: '図面・設計の誤り', description: '図面の記載漏れや寸法誤り、設計ミス、干渉、部品選定ミス、仕様変更の反映漏れ、検討不足など、図面や設計の内容に誤りがあった。' },
  { id: 'machining', label: '加工・組立・段取りのミス', description: '加工間違い、段取りミス、原点やプログラムの誤り、入力・操作ミス、固定不足、組付けミスなど、作業の実行で誤った。' },
  { id: 'measure', label: '測定・検査方法の誤り', description: '測定誤差、測定方法や測定器の選び方の誤りなど、測定のしかたが原因。' },
  { id: 'order', label: '手配・発注・出図の漏れ', description: '手配漏れ、追加手配の失念、数量の誤り、出図の分割やタイミングなど、手配や発注の手続きが原因。' },
  { id: 'supply', label: '材料・外注・支給品の不良', description: '材料不良、外注加工や外注塗装の不良、メーカ図やメーカ品の問題、支給品の問題など、社外から入るものが原因。' },
  { id: 'handling', label: '取扱い・保管・運搬での破損', description: '落下、接触による破損、養生不足、保管や運搬のしかたなど、物の取扱いが原因。' },
  { id: 'process', label: '手順・教育・情報伝達の不足', description: '作業手順の不備、知らなかった、教育不足、指示や連絡が伝わらなかったなど、手順や教育や伝達が原因。' },
  { id: 'unknown', label: '不明・記載なし', description: '原因不明と書かれている、現象や場所や番号だけで要因が書かれていない、他の記録を参照しているだけ。' },
].map(Object.freeze));
export const CAUSE_CATEGORY_IDS = Object.freeze(CAUSE_CATEGORIES.map(({ id }) => id));
export const CAUSE_PROMPT_VERSION = 'hermes-retrieval-cause-prompt/v1';
const instructionsTemplate = '`records` の no={no} の「condition」(不適合内容の記述) から、その不適合の主な要因の区分を一つ選ぶ。複数当てはまるときは、より根本に近いものを選ぶ。要因が読み取れないときは unknown。';
const criteria = Object.freeze(Object.fromEntries(CAUSE_CATEGORIES.map(({ id, label, description }) => [id, `${label}: ${description}`])));
const hash = text => createHash('sha256').update(text).digest('hex');

export function causeLabel(id) {
  return CAUSE_CATEGORIES.find(category => category.id === id)?.label ?? id;
}

export function normalizeConditionText(text) {
  return typeof text === 'string' ? text.normalize('NFKC').replace(/\s+/gu, ' ').trim() : '';
}

export function conditionSha256(text) {
  return hash(normalizeConditionText(text));
}

export function buildCauseQuestions(texts) {
  if (!Array.isArray(texts) || texts.length > 10) throw new RangeError('cause batches contain at most 10 texts');
  return {
    state: { records: texts.map((text, index) => ({ no: index + 1, condition: normalizeConditionText(text).slice(0, 400) })) },
    questions: Object.fromEntries(texts.map((_, index) => [`r${index + 1}`, {
      type: 'choice', instructions: instructionsTemplate.replace('{no}', String(index + 1)), criteria,
    }])),
    promptSha256: hash(JSON.stringify({ version: CAUSE_PROMPT_VERSION, instructionsTemplate, criteria })),
  };
}

export function parseCauseAnswers(answers, count) {
  return Array.from({ length: count }, (_, index) => {
    const choice = answers?.[`r${index + 1}`]?.choice;
    return { categoryId: CAUSE_CATEGORY_IDS.includes(choice) ? choice : null };
  });
}
