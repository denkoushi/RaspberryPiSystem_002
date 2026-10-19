// Offline classification: neither the store nor diagnostics contain record text.
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { buildCauseQuestions, conditionSha256, normalizeConditionText, parseCauseAnswers } from './cause-categories.mjs';
import { defaultEvaluate } from './jev-evaluate.mjs';
import {
  CAUSE_STORE_SCHEMA, causeFailuresPathFor, causeStorePathFromEnv, causeStatusPathFromEnv,
  readCauseFailures, readCauseStore, writeCauseFailures, writeCauseStore, writeCauseStatus,
} from './cause-store.mjs';

export const MAX_CONTENT_ATTEMPTS = 3;
const CONTENT_FAILURES = new Set(['invalid_json', 'invalid_answers']);

export async function runCauseBatch({
  records = [], env = process.env, evaluate = defaultEvaluate,
  storePath = causeStorePathFromEnv(env), statusPath = causeStatusPathFromEnv(env),
  now = () => new Date(),
} = {}) {
  const max = Number(env.HERMES_RETRIEVAL_CAUSE_MAX_TEXTS);
  const maxTexts = Number.isInteger(max) && max > 0 ? max : 600;
  const concurrency = env.HERMES_RETRIEVAL_CAUSE_CONCURRENCY === '2' ? 2 : 1;
  const { promptSha256 } = buildCauseQuestions([]);
  const texts = new Map();
  for (const row of records) {
    if (!row || (row.kind && row.kind !== 'nonconformity')) continue;
    const text = normalizeConditionText(row.condition);
    if (text) texts.set(conditionSha256(text), text);
  }
  const status = {
    schema: 'hermes-retrieval-cause-status/v1', startedAt: now().toISOString(), finishedAt: null,
    reason: 'completed', texts: { total: texts.size, classified: 0, pending: texts.size, failed: 0 },
    processed: 0, calls: 0, meanCallMs: 0, maxTexts, concurrency, promptSha256,
  };
  const publish = async () => {
    status.finishedAt = now().toISOString();
    await writeCauseStatus(statusPath, status);
    console.info(`hermes retrieval cause reason=${status.reason} processed=${status.processed}`);
    return status;
  };
  if (env.HERMES_RETRIEVAL_CAUSE_ENABLED !== 'true') {
    status.reason = 'disabled';
    return publish();
  }
  const byHash = await readCauseStore(storePath);
  const failuresPath = causeFailuresPathFor(storePath);
  const failures = await readCauseFailures(failuresPath);
  const current = hash => byHash.get(hash)?.promptSha256 === promptSha256;
  const attempts = hash => failures.get(hash)?.attempts ?? 0;
  const pending = [...texts].filter(([hash]) => !current(hash) && attempts(hash) < MAX_CONTENT_ATTEMPTS)
    .sort(([a], [b]) => attempts(a) - attempts(b)).slice(0, maxTexts);
  if (!pending.length) status.reason = 'nothing_to_do';
  let callMs = 0;
  for (let index = 0; index < pending.length; index += 10 * concurrency) {
    const batches = [];
    for (let offset = index; offset < Math.min(index + 10 * concurrency, pending.length); offset += 10) {
      batches.push(pending.slice(offset, offset + 10));
    }
    const results = await Promise.all(batches.map(async batch => {
      const started = performance.now();
      const { state, questions } = buildCauseQuestions(batch.map(([, text]) => text));
      try {
        const result = await evaluate({ state, questions });
        return { batch, answers: parseCauseAnswers(result?.answers, batch.length), ms: performance.now() - started };
      } catch (error) {
        const contentFailure = CONTENT_FAILURES.has(error?.hermesDiagnostic?.failureCode);
        return { batch, answers: contentFailure ? parseCauseAnswers(null, batch.length) : null, ms: performance.now() - started };
      }
    }));
    // Persist serially even with two calls in flight, so an older write cannot replace a newer batch.
    for (const { batch, answers, ms } of results) {
      status.calls += 1;
      callMs += ms;
      if (!answers) { status.reason = 'backoff'; continue; }
      status.processed += batch.length;
      for (const [offset, [textSha256]] of batch.entries()) {
        const categoryId = answers[offset].categoryId;
        if (categoryId) {
          byHash.set(textSha256, { schema: CAUSE_STORE_SCHEMA, textSha256, categoryId, promptSha256, classifiedAt: now().toISOString() });
          failures.delete(textSha256);
        } else {
          failures.set(textSha256, { textSha256, attempts: attempts(textSha256) + 1, lastAt: now().toISOString() });
        }
      }
      await writeCauseStore(storePath, byHash);
      await writeCauseFailures(failuresPath, failures);
    }
    if (status.reason === 'backoff') break;
  }
  status.meanCallMs = status.calls ? Math.round(callMs / status.calls) : 0;
  for (const hash of texts.keys()) {
    if (current(hash)) status.texts.classified += 1;
    else if (attempts(hash) >= MAX_CONTENT_ATTEMPTS) status.texts.failed += 1;
  }
  status.texts.pending = texts.size - status.texts.classified - status.texts.failed;
  return publish();
}

export async function main() {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    await runCauseBatch({ records: Array.isArray(payload.records) ? payload.records : [] });
  } catch {
    console.info('hermes retrieval cause reason=backoff processed=0');
  }
  process.exitCode = 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
