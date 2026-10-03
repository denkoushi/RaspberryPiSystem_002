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

function bigrams(value) {
  const textValue = normalize(value);
  const grams = [];
  for (let index = 0; index + 1 < textValue.length; index += 1) grams.push(textValue.slice(index, index + 2));
  return grams;
}

/** Why a question copies the anchor record too closely, or null when it does not. */
export function copyViolation(question, anchorBody) {
  const q = normalize(question);
  const body = normalize(anchorBody);
  for (let index = 0; index + COPY_RUN_CHARS <= q.length; index += 1) {
    if (body.includes(q.slice(index, index + COPY_RUN_CHARS))) return 'copied_run';
  }
  const grams = bigrams(q);
  if (grams.length >= 4) {
    const shared = grams.filter((gram) => body.includes(gram)).length;
    if (shared / grams.length > COPY_BIGRAM_SHARE) return 'copied_words';
  }
  return null;
}

export function validateQuestion(question, anchorBody) {
  const textValue = typeof question === 'string' ? question.trim() : '';
  if (!textValue) return 'empty';
  if (textValue.length > QUESTION_MAX_CHARS) return 'too_long';
  if (/\d{6,}/u.test(textValue) || /[A-Z]{2}\d{5,}/u.test(textValue)) return 'record_number';
  return copyViolation(textValue, anchorBody);
}

export function buildMessages({ seed, factsA, factsB }) {
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
  const messages = buildMessages({ seed, factsA: recordFacts(recordA), factsB: recordFacts(recordB) });
  const reply = await chat({ messages, schema: QUESTION_SCHEMA, temperature: 0.7 });
  if (!reply?.ok) return { ok: false, reason: reply?.reason ?? 'chat_failed' };
  let question = null;
  try {
    question = JSON.parse(reply.content)?.question;
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  const violation = validateQuestion(question, anchorBody);
  if (violation) return { ok: false, reason: violation };
  return { ok: true, question: question.trim() };
}

/**
 * Chat adapter for the DGX business LLM, the same route and headers as enrichment-dgx.mjs:
 * `origin`, `token`, and `egress` come from HERMES_INFERENCE_ORIGIN, HERMES_INFERENCE_TOKEN, and
 * HERMES_INFERENCE_EGRESS. Answer text is never logged.
 */
export function createDgxChat({ origin, token, egress = '', model = 'system-prod-primary', timeoutMs = 50_000, maxTokens = 200, fetchImpl }) {
  if (!origin || !token) throw new Error('inference origin or token is not configured');
  const fetchFn = fetchImpl ?? (egress ? throughEgress(egress) : fetch);
  return async function chat({ messages, schema, temperature = 0 }) {
    try {
      const response = await fetchFn(`${origin.replace(/\/$/u, '')}/v1/chat/completions`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-llm-token': token },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
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
