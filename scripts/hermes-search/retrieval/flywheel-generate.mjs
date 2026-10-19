// One synthetic question per contrastive pair and seed. The generator sees short field facts of
// records A and B, never the full text, and the question is rejected when it copies A's wording
// too closely: a question written while reading the answer reuses its words and is too easy for
// lexical search ("curse of knowledge"). The chat call is injected; on the Pi 5 it is the DGX
// business LLM through the consultation egress (createDgxChat).
import { throughEgress } from '../hermes-remote-inference.mjs';
import { INTENTS, ROLES, STYLES } from './flywheel-seeds.mjs';

export const QUESTION_MAX_CHARS = 60;
// A run this long copied from A's body is a quotation, not a question.
export const COPY_RUN_CHARS = 8;
// Share of the question's character bigrams that may also appear in A's body.
export const COPY_BIGRAM_SHARE = 0.6;
// Whole-question bound: the share of the question's character bigrams found in the anchor body.
// On the first night (2026-10-03) the kept median was 0.44 and terse questions 0.56; questions
// above 0.5 were found by lexical search alone, so the set could not show the dense gain. One
// retry asks for other wording before the pair is dropped.
export const QUESTION_OVERLAP_MAX = 0.5;
const FACT_CHARS = 60;

const FACT_FIELDS = [
  ['partName', '品名'],
  ['machineName', '機械名'],
  ['originDepartmentName', '起因部署'],
  ['condition', '不適合内容'],
  ['remarks', '備考'],
  ['correctiveContent', '個別是正内容'],
  ['disposition', '処置内容'],
];

function normalize(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, '');
}

function firstClause(value) {
  const textValue = String(value ?? '').replace(/\s+/gu, ' ').trim();
  if (!textValue) return '';
  const cut = textValue.split(/[。\n]/u)[0] || textValue;
  return cut.length > FACT_CHARS ? `${cut.slice(0, FACT_CHARS)}…` : cut;
}

/** Short field facts: the first clause of each field, cut at FACT_CHARS. */
export function recordFacts(record) {
  return FACT_FIELDS
    .map(([key, label]) => [label, firstClause(record?.[key])])
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
}

// Words separated by spaces or punctuation are checked one by one. A terse question such as
// 「スケールカバー 取付忘れ 不適合」 joins the record's own terms, as people type them; joined
// together they would look like a copied run (trial of 2026-10-03, 69 pairs). Only a token
// written as a sentence (SENTENCE_CHARS or longer) is also held to the bigram share.
export const SENTENCE_CHARS = 15;

function tokens(value) {
  return String(value ?? '').normalize('NFKC').split(/[\s、。，,・!?！？]+/u).filter(Boolean);
}

function bigrams(value) {
  const textValue = normalize(value);
  const grams = [];
  for (let index = 0; index + 1 < textValue.length; index += 1) grams.push(textValue.slice(index, index + 2));
  return grams;
}

/** Why a question copies the anchor record too closely, or null when it does not. */
export function copyViolation(question, anchorBody) {
  const body = normalize(anchorBody);
  for (const token of tokens(question)) {
    for (let index = 0; index + COPY_RUN_CHARS <= token.length; index += 1) {
      if (body.includes(token.slice(index, index + COPY_RUN_CHARS))) return 'copied_run';
    }
    if (token.length < SENTENCE_CHARS) continue;
    const grams = bigrams(token);
    const shared = grams.filter((gram) => body.includes(gram)).length;
    if (shared / grams.length > COPY_BIGRAM_SHARE) return 'copied_words';
  }
  return null;
}

/** Share of the question's character bigrams that appear in the anchor body, 0 to 1. */
export function anchorOverlap(question, anchorBody) {
  const body = normalize(anchorBody);
  const grams = bigrams(tokens(question).join(''));
  if (!grams.length) return 0;
  return Math.round((grams.filter((gram) => body.includes(gram)).length / grams.length) * 100) / 100;
}

export function validateQuestion(question, anchorBody) {
  const textValue = typeof question === 'string' ? question.trim() : '';
  if (!textValue) return 'empty';
  if (textValue.length > QUESTION_MAX_CHARS) return 'too_long';
  if (/\d{6,}/u.test(textValue) || /[A-Z]{2}\d{5,}/u.test(textValue)) return 'record_number';
  return copyViolation(textValue, anchorBody);
}

export function buildMessages({ seed, factsA, factsB, previous = null }) {
  const intent = INTENTS.find((item) => item.id === seed.intent);
  const style = STYLES.find((item) => item.id === seed.style);
  const role = ROLES.find((item) => item.id === seed.role);
  const system = [
    'あなたは製造業の工場で働く人として、不適合記録の検索窓に入力する質問を1つだけ作る。',
    '記録Aは探している記録、記録Bはよく似ているが探していない記録である。',
    '質問は記録Aの出来事に当てはまり、記録Bには当てはまらないこと。',
    '記録の文章を写さず、自分の言葉で書く。記録の番号や品番の英数字は書かない。',
    `尋ねる人: ${role.label}。知りたいこと: ${intent.label}。`,
    `書き方: ${style.instruction}`,
    `${QUESTION_MAX_CHARS}文字以内。JSON で {"question": "..."} だけを返す。`,
    ...(previous ? [`前の案「${previous}」は記録の語句と重なりすぎた。記録に出てくる言葉をそのまま使わず、現場で使う別の言い方に置き換える。`] : []),
  ].join('\n');
  const user = `記録A:\n${factsA}\n\n記録B:\n${factsB}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

export const QUESTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['question'],
  properties: { question: { type: 'string', maxLength: 120 } },
};

/**
 * Generates one question. `chat({ messages, schema, temperature })` returns
 * `{ ok: true, content } | { ok: false, reason }`.
 */
export async function generateQuestion({ seed, recordA, recordB, anchorBody, chat }) {
  const facts = { factsA: recordFacts(recordA), factsB: recordFacts(recordB) };
  let previous = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const messages = buildMessages({ seed, ...facts, previous });
    const reply = await chat({ messages, schema: QUESTION_SCHEMA, temperature: previous ? 0.9 : 0.7 });
    if (!reply?.ok) return { ok: false, reason: reply?.reason ?? 'chat_failed' };
    let question = null;
    try {
      question = JSON.parse(reply.content)?.question;
    } catch {
      return { ok: false, reason: 'invalid_json' };
    }
    const violation = validateQuestion(question, anchorBody);
    if (violation) return { ok: false, reason: violation };
    const overlap = anchorOverlap(question, anchorBody);
    if (overlap <= QUESTION_OVERLAP_MAX) return { ok: true, question: question.trim(), overlap, retried: attempt > 0 };
    previous = question.trim();
  }
  return { ok: false, reason: 'too_similar', overlap: anchorOverlap(previous, anchorBody) };
}

/**
 * Chat adapter for the DGX business LLM, the same route and headers as enrichment-dgx.mjs:
 * `origin`, `token`, and `egress` come from HERMES_INFERENCE_ORIGIN, HERMES_INFERENCE_TOKEN, and
 * HERMES_INFERENCE_EGRESS. Answer text is never logged.
 */
export function createDgxChat({ origin, token, egress = '', model = 'system-prod-primary', timeoutMs = 50_000, maxTokens = 200, fetchImpl }) {
  if (!origin || !token) throw new Error('inference origin or token is not configured');
  const fetchFn = fetchImpl ?? (egress ? throughEgress(egress) : fetch);
  return async function chat({ messages, schema, temperature = 0, timeoutMs: requestTimeoutMs = timeoutMs, maxTokens: requestMaxTokens = maxTokens }) {
    try {
      const response = await fetchFn(`${origin.replace(/\/$/u, '')}/v1/chat/completions`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(requestTimeoutMs),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-llm-token': token },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: requestMaxTokens,
          chat_template_kwargs: { enable_thinking: false },
          ...(schema ? { response_format: { type: 'json_schema', json_schema: { name: 'flywheel', strict: true, schema } } } : {}),
        }),
      });
      if (!response.ok) {
        await response.text().catch(() => '');
        return { ok: false, reason: `http_${response.status}` };
      }
      const payload = JSON.parse(await response.text());
      const choice = payload?.choices?.[0];
      if (choice?.finish_reason === 'length') return { ok: false, reason: 'truncated' };
      return { ok: true, content: choice?.message?.content ?? '' };
    } catch (error) {
      return { ok: false, reason: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'transport' };
    }
  };
}

/** A tiny readiness request; pass the raw chat so it does not consume guard strikes. */
export async function probeChat(chat, { timeoutMs = 15_000 } = {}) {
  try {
    const reply = await chat({ messages: [{ role: 'user', content: 'Reply OK.' }], maxTokens: 8, timeoutMs });
    return reply?.ok ? { ok: true } : { ok: false, reason: reply?.reason ?? 'transport' };
  } catch (error) {
    return { ok: false, reason: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'transport' };
  }
}

/**
 * Questions for a list of pairs. Each pair gets one seed restricted to the intents record A can
 * answer. Returns one row per pair: ids, seed, and the question or the reason it was dropped.
 * Rows hold no record text.
 */
export async function generateForPairs({ pairs, recordsById, random, chat, sampleSeed, answerableIntents, bodyText }) {
  const rows = [];
  for (const pair of pairs) {
    const recordA = recordsById.get(pair.a);
    const recordB = recordsById.get(pair.b);
    const seed = recordA && recordB ? sampleSeed({ random, allowedIntents: answerableIntents(recordA) }) : null;
    if (!seed) {
      rows.push({ ...pair, seed: null, ok: false, reason: 'no_seed' });
      continue;
    }
    const result = await generateQuestion({ seed, recordA, recordB, anchorBody: bodyText(recordA), chat });
    rows.push({ ...pair, seed, ...result });
  }
  return rows;
}

// The business LLM also answers daytime consultations. On 2026-10-03 a trial slowed from about
// ten questions a minute to one and seven calls timed out in a row, so a night run stops calling
// the model once calls stay slow or failing, and leaves the rest for the next night.
export const SLOW_CALL_MS = 15_000;
export const MAX_STRIKES = 3;

/**
 * Wraps a chat function. A call that fails or takes longer than slowMs is a strike; a fast
 * success clears them. After maxStrikes strikes in a row every later call returns
 * { ok: false, reason: 'dgx_busy' } without calling the model.
 */
export function guardChat(chat, { slowMs = SLOW_CALL_MS, maxStrikes = MAX_STRIKES, now = () => Date.now() } = {}) {
  let strikes = 0;
  const guarded = async function guardedChat(request) {
    if (strikes >= maxStrikes) return { ok: false, reason: 'dgx_busy' };
    const started = now();
    const reply = await chat(request);
    const slow = now() - started > slowMs;
    strikes = !reply?.ok || slow ? strikes + 1 : 0;
    return reply;
  };
  guarded.tripped = () => strikes >= maxStrikes;
  return guarded;
}
