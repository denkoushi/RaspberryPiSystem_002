// Offline evaluation: does TypeSafe JEV (image input) tell whether two adjacent pages belong to the same document?
// Usage: TYPESAFE_API_KEY=... node jev-page-boundary-eval.mjs <evalDir> [--limit N] [--probe-text]
import { readFile, appendFile } from 'node:fs/promises';

const DIRECT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const DIRECT_MODEL = process.env.JEV_MODEL ?? 'jev-1.13.0';
const DIRECT_TIMEOUT_MS = 60_000;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function safeDirectError(message, failureCode, httpStatus, detail) {
  const error = new Error(message);
  error.name = 'TypeSafeDirectError';
  error.diagnostic = { failureCode, ...(Number.isInteger(httpStatus) ? { httpStatus } : {}), ...(detail ? { detail } : {}) };
  return error;
}

// Same shape as createTypesafeDirectEvaluate in scripts/hermes-search/hermes-jev-record-pilot.mjs, plus the image header and assets.
export function createTypesafeImageEvaluate({ apiKey = process.env.TYPESAFE_API_KEY, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) throw safeDirectError('TYPESAFE_API_KEY is required', 'missing_credentials');
  return async ({ state, questions, assets }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
    try {
      const response = await fetchImpl(DIRECT_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(assets ? { 'TypeSafe-Danger-Zone-Images': 'true' } : {}),
        },
        body: JSON.stringify({ model: DIRECT_MODEL, state, questions, ...(assets ? { assets } : {}) }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 400);
        throw safeDirectError(`TypeSafe API returned HTTP ${response.status}`, 'upstream_http', response.status, detail);
      }
      let result;
      try {
        result = await response.json();
      } catch {
        throw safeDirectError('TypeSafe API returned invalid JSON', 'invalid_json');
      }
      if (!isObject(result) || !isObject(result.answers)) throw safeDirectError('TypeSafe API response has no answers', 'invalid_answers');
      return result;
    } catch (error) {
      if (error?.name === 'AbortError') throw safeDirectError(`TypeSafe API timed out after ${DIRECT_TIMEOUT_MS}ms`, 'timeout');
      if (error?.name === 'TypeSafeDirectError') throw error;
      throw safeDirectError('TypeSafe API connection failed', 'connection_failed');
    } finally {
      clearTimeout(timeout);
    }
  };
}

const QUESTION = {
  type: 'choice',
  instructions:
    '`prev_page` と `next_page` は、紙の書類を 1 枚ずつ撮影・スキャンした連続する 2 ページの画像である。' +
    '`next_page` が `prev_page` と同じ書類(同じ要領書・図面・帳票)の続きのページか、別の書類の最初のページかを一つ選ぶ。' +
    '文書番号・表題・品番・図番・様式・ページ番号(例 1/2)の一致や違いを手がかりにする。様式が同じでも文書番号や表題が違えば別の書類とする。',
  criteria: {
    continuation: '`next_page` は `prev_page` と同じ書類の続きのページ',
    new_document: '`next_page` は `prev_page` とは別の書類の最初のページ',
  },
};

async function asset(path) {
  return { type: 'image', format: 'jpeg', data_base64: (await readFile(path)).toString('base64') };
}

async function main() {
  const [dir, ...rest] = process.argv.slice(2);
  const limit = rest.includes('--limit') ? Number(rest[rest.indexOf('--limit') + 1]) : Infinity;
  const out = rest.includes('--out') ? rest[rest.indexOf('--out') + 1] : `${dir}/results.jsonl`;
  const evaluate = createTypesafeImageEvaluate();
  if (rest.includes('--probe-text')) {
    const result = await evaluate({
      state: { request: '前のページは文書番号 産1-G012AAK-0 の 2 ページ目、次のページは文書番号 産1-G013AAK-0 の表紙' },
      questions: { boundary: { ...QUESTION, instructions: '`request` を読み、次のページが前のページと同じ書類の続きか、別の書類の最初のページかを一つ選ぶ。' } },
    });
    console.log(JSON.stringify({ answers: result.answers, usage: result.usage ?? null, keys: Object.keys(result) }, null, 1));
    return;
  }
  const pages = JSON.parse(await readFile(`${dir}/dataset.json`, 'utf8'));
  const done = new Set((await readFile(out, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((line) => JSON.parse(line)).filter((row) => !row.error).map((row) => row.pair));
  let n = 0;
  for (let i = 1; i < pages.length && n < limit; i += 1) {
    const [a, b] = [pages[i - 1], pages[i]];
    const pair = `${a.id}>${b.id}`;
    if (done.has(pair)) continue;
    n += 1;
    const truth = b.start ? 'new_document' : 'continuation';
    const started = performance.now();
    let row;
    try {
      const result = await evaluate({
        state: { prev_page: `page-${a.id}`, next_page: `page-${b.id}` },
        questions: { boundary: QUESTION },
        assets: { [`page-${a.id}`]: await asset(`${dir}/pages/${a.id}.jpg`), [`page-${b.id}`]: await asset(`${dir}/pages/${b.id}.jpg`) },
      });
      row = { pair, truth, model: DIRECT_MODEL, answer: result.answers.boundary, usage: result.usage ?? null, ms: Math.round(performance.now() - started) };
    } catch (error) {
      row = { pair, truth, model: DIRECT_MODEL, error: error.diagnostic ?? { failureCode: 'unknown', message: String(error?.message) }, ms: Math.round(performance.now() - started) };
    }
    await appendFile(out, `${JSON.stringify(row)}\n`);
    console.log(pair, truth, row.error ? `ERROR ${JSON.stringify(row.error)}` : JSON.stringify(row.answer), JSON.stringify(row.usage), row.ms, 'ms');
  }
}

main().catch((error) => {
  console.error(error.name, error.message, JSON.stringify(error.diagnostic ?? {}));
  process.exit(1);
});
