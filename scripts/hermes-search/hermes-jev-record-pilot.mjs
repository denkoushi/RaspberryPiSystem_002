import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(HERE, 'hermes-jev-record-pilot-fixture.json');
const MODEL = 'typesafe-ai/jev';
const DIRECT_PROVIDER = 'typesafe-direct';
const DIRECT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const DIRECT_MODEL = 'jev-latest';
const DIRECT_TIMEOUT_MS = 10_000;
const AXES = ['process', 'phenomenon', 'treatment', 'cause'];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateFixture(fixture) {
  if (!isObject(fixture) || ![1, 2].includes(fixture.schemaVersion)) throw new Error('unsupported fixture');
  if (!isObject(fixture.classificationAxes) || AXES.some((axis) => !Array.isArray(fixture.classificationAxes[axis]))) {
    throw new Error('classification axes are incomplete');
  }
  for (const axis of AXES) {
    const ids = fixture.classificationAxes[axis].map((option) => option.id);
    if (new Set(ids).size !== ids.length || !ids.includes('unknown')) throw new Error(`invalid options for ${axis}`);
  }
  if (!Array.isArray(fixture.records) || !fixture.records.length || !Array.isArray(fixture.queries) || !fixture.queries.length) {
    throw new Error('fixture size changed');
  }
  const recordIds = new Set();
  for (const item of fixture.records) {
    if (!item.id || typeof item.rawText !== 'string' || !item.rawText.trim() || !isObject(item.expectedClassification)) throw new Error('invalid record fixture item');
    if (recordIds.has(item.id)) throw new Error('duplicate record fixture id');
    recordIds.add(item.id);
    for (const axis of AXES) if (!Object.hasOwn(item.expectedClassification, axis)) throw new Error(`missing expected ${axis}`);
  }
  const queryIds = new Set();
  for (const item of fixture.queries) {
    if (!item.id || typeof item.text !== 'string' || !item.text.trim() || !isObject(item.expectedClassification)) throw new Error('invalid query fixture item');
    if (queryIds.has(item.id)) throw new Error('duplicate query fixture id');
    queryIds.add(item.id);
    if (!Array.isArray(item.expectedRecordIds)) throw new Error('missing expected record ids');
    for (const axis of AXES) if (!Object.hasOwn(item.expectedClassification, axis)) throw new Error(`missing expected ${axis}`);
  }
  if (fixture.records.some((record) => typeof record.rawText !== 'string' || record.rawText !== record.rawText.trim())) throw new Error('invalid original text');
  return fixture;
}

function questionFor(axis, options, mode) {
  const scope = mode === 'record' ? '本文' : '検索質問';
  const criteria = Object.fromEntries(options.map(({ id, description }) => [id, description]));
  return {
    type: 'choice',
    instructions: `${scope}に記載された${axis}を一つ選ぶ。記載がなければ unknown を選び、本文にない原因・処置・工程を補わない。`,
    criteria,
  };
}

function winner(answer, axis) {
  if (!isObject(answer) || answer.type !== 'choice' || typeof answer.choice !== 'string') throw new Error(`invalid JEV answer for ${axis}`);
  return answer.choice;
}

function buildState(request) {
  return { request, relatedHistory: [], confirmationPending: null };
}

function buildQuestions(fixture, mode) {
  return Object.fromEntries(AXES.map((axis) => [axis, questionFor(axis, fixture.classificationAxes[axis], mode)]));
}

function connectionMetadata() {
  if (process.env.HERMES_JEV_PROVIDER === DIRECT_PROVIDER) {
    return { provider: DIRECT_PROVIDER, endpoint: DIRECT_ENDPOINT, model: DIRECT_MODEL };
  }
  return { provider: 'vercel-ai-gateway', endpoint: null, model: MODEL };
}

function safeDirectError(message, failureCode, httpStatus) {
  const error = new Error(message);
  error.name = 'TypeSafeDirectError';
  error.hermesDiagnostic = {
    provider: DIRECT_PROVIDER,
    failureCode,
    ...(Number.isInteger(httpStatus) ? { httpStatus } : {}),
  };
  return error;
}

export function createTypesafeDirectEvaluate({ apiKey = process.env.TYPESAFE_API_KEY, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) throw safeDirectError('TYPESAFE_API_KEY is required for the typesafe-direct provider', 'missing_credentials');
  if (typeof fetchImpl !== 'function') throw safeDirectError('global fetch is required for the typesafe-direct provider', 'transport_unavailable');

  return async (input) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
    try {
      const response = await fetchImpl(DIRECT_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: DIRECT_MODEL, state: input.state, questions: input.questions }),
        signal: controller.signal,
      });
      if (!response.ok) throw safeDirectError(`TypeSafe API returned HTTP ${response.status}`, 'upstream_http', response.status);
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

async function defaultEvaluate(input) {
  if (process.env.HERMES_JEV_PROVIDER === DIRECT_PROVIDER) return createTypesafeDirectEvaluate()(input);
  if (process.env.HERMES_JEV_PROVIDER && process.env.HERMES_JEV_PROVIDER !== 'vercel-ai-gateway') {
    throw new Error(`unsupported HERMES_JEV_PROVIDER: ${process.env.HERMES_JEV_PROVIDER}`);
  }
  const { experimental_evaluate: evaluate } = await import('ai');
  return evaluate(input);
}

async function loadFixture(fixturePath) {
  if (fixturePath.endsWith('.mjs') || fixturePath.endsWith('.js')) {
    const module = await import(pathToFileURL(fixturePath).href);
    return validateFixture(module.default ?? module.fixture ?? module.expandedFixture);
  }
  return validateFixture(JSON.parse(await readFile(fixturePath, 'utf8')));
}

function classificationDefinitionHash(fixture) {
  return sha256(JSON.stringify(fixture.classificationAxes));
}

function recordTextHash(record) {
  return sha256(record.rawText);
}

function validClassification(classification, fixture) {
  return isObject(classification) && AXES.every((axis) => {
    const values = new Set(fixture.classificationAxes[axis].map((option) => option.id));
    return values.has(classification[axis]);
  });
}

export async function classifyText(text, fixture, evaluateImplementation = defaultEvaluate, mode = 'record') {
  const result = await evaluateImplementation({
    model: MODEL,
    state: buildState(text),
    questions: buildQuestions(fixture, mode),
    maxRetries: 0,
  });
  const answers = result?.answers;
  if (!isObject(answers)) throw new Error('JEV response has no answers');
  const classification = Object.fromEntries(AXES.map((axis) => [axis, winner(answers[axis], axis)]));
  const allowed = new Map(AXES.map((axis) => [axis, new Set(fixture.classificationAxes[axis].map((option) => option.id))]));
  for (const axis of AXES) if (!allowed.get(axis).has(classification[axis])) throw new Error(`JEV returned unsupported ${axis}`);
  return { classification, response: result.response ?? null, usage: result.usage ?? null };
}

export function createStore(fixture, classifiedRecords) {
  if (classifiedRecords.length !== fixture.records.length) throw new Error('classification count mismatch');
  const recordById = new Map(fixture.records.map((record) => [record.id, record]));
  const classificationById = new Map(classifiedRecords.map((item) => [item.id, item.classification]));
  if (classificationById.size !== fixture.records.length) throw new Error('classification identities mismatch');
  return {
    schemaVersion: 1,
    records: fixture.records.map(({ id, rawText }) => ({ id, rawText })),
    classifications: fixture.records.map(({ id }) => ({ id, ...classificationById.get(id) })),
    _recordById: recordById,
  };
}

function persistedStore(fixture, store) {
  return {
    schemaVersion: 1,
    fixtureId: fixture.fixtureId ?? null,
    classificationDefinitionSha256: classificationDefinitionHash(fixture),
    records: fixture.records.map((record) => ({ id: record.id, rawText: record.rawText, rawTextSha256: recordTextHash(record) })),
    classifications: store.classifications,
  };
}

async function readPersistedStore(storePath) {
  if (!storePath) return null;
  try {
    const saved = JSON.parse(await readFile(storePath, 'utf8'));
    if (!isObject(saved) || saved.schemaVersion !== 1 || !Array.isArray(saved.records) || !Array.isArray(saved.classifications)) return null;
    return saved;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writePersistedStore(storePath, value) {
  if (!storePath) return;
  await mkdir(path.dirname(storePath), { recursive: true });
  const temporaryPath = `${storePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, storePath);
}

async function classifyRecordsIncrementally({ fixture, storePath, evaluateAndAudit }) {
  const saved = await readPersistedStore(storePath);
  const savedRecords = new Map((saved?.records ?? []).map((record) => [record.id, record]));
  const savedClassifications = new Map((saved?.classifications ?? []).map((classification) => [classification.id, classification]));
  const definitionHash = classificationDefinitionHash(fixture);
  const classifiedRecords = [];
  let reusedRecordCount = 0;
  let newOrChangedRecordCount = 0;
  for (const record of fixture.records) {
    const previousRecord = savedRecords.get(record.id);
    const previousClassification = savedClassifications.get(record.id);
    if (saved?.classificationDefinitionSha256 === definitionHash
      && previousRecord?.rawTextSha256 === recordTextHash(record)
      && validClassification(previousClassification, fixture)) {
      classifiedRecords.push({ id: record.id, classification: Object.fromEntries(AXES.map((axis) => [axis, previousClassification[axis]])) });
      reusedRecordCount += 1;
      continue;
    }
    const evaluated = await classifyText(record.rawText, fixture, evaluateAndAudit, 'record');
    classifiedRecords.push({ id: record.id, classification: evaluated.classification });
    newOrChangedRecordCount += 1;
  }
  const store = createStore(fixture, classifiedRecords);
  await writePersistedStore(storePath, persistedStore(fixture, store));
  return { store, reusedRecordCount, newOrChangedRecordCount };
}

export function searchStored(store, classification) {
  const matches = store.classifications
    .filter((saved) => AXES.every((axis) => classification[axis] === 'unknown' || saved[axis] === classification[axis]))
    .map((saved) => store._recordById.get(saved.id));
  return matches.map((record) => ({ id: record.id, rawText: record.rawText }));
}

export async function runPilot({ fixturePath = FIXTURE_PATH, outputPath, storePath, evaluateImplementation = defaultEvaluate } = {}) {
  const fixture = await loadFixture(fixturePath);
  const calls = [];
  const evaluateAndAudit = async (input, phase = 'query') => {
    const started = performance.now();
    const result = await evaluateImplementation(input);
    calls.push({ phase, requestSha256: sha256(input.state.request), model: connectionMetadata().model, questionCount: Object.keys(input.questions).length, latencyMs: Number((performance.now() - started).toFixed(3)) });
    return result;
  };
  const recordClassificationStarted = performance.now();
  const incremental = await classifyRecordsIncrementally({ fixture, storePath, evaluateAndAudit: (input) => evaluateAndAudit(input, 'record') });
  const recordClassificationElapsedMs = Number((performance.now() - recordClassificationStarted).toFixed(3));
  const { store, reusedRecordCount, newOrChangedRecordCount } = incremental;
  const searches = [];
  const queryAndSearchStarted = performance.now();
  for (const query of fixture.queries) {
    const evaluated = await classifyText(query.text, fixture, (input) => evaluateAndAudit(input, 'query'), 'query');
    const records = searchStored(store, evaluated.classification);
    searches.push({ id: query.id, classification: evaluated.classification, records });
  }
  const queryAndSearchElapsedMs = Number((performance.now() - queryAndSearchStarted).toFixed(3));
  const result = {
    schemaVersion: 1,
    connection: connectionMetadata(),
    model: connectionMetadata().model,
    fixturePath,
    recordCount: fixture.records.length,
    classificationCalls: calls.filter((call) => call.phase === 'record').length,
    reusedRecordCount,
    newOrChangedRecordCount,
    queryClassificationCalls: fixture.queries.length,
    searchRecordJevCalls: 0,
    recordClassificationElapsedMs,
    queryAndSearchElapsedMs,
    totalElapsedMs: Number((recordClassificationElapsedMs + queryAndSearchElapsedMs).toFixed(3)),
    calls,
    store: { records: store.records, classifications: store.classifications },
    searches,
  };
  if (outputPath) await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}

export class RecordPilot {
  constructor({ fixturePath, storePath, evaluateImplementation = defaultEvaluate } = {}) {
    this.fixturePath = fixturePath ?? FIXTURE_PATH;
    this.storePath = storePath;
    this.evaluateImplementation = evaluateImplementation;
    this.calls = [];
    this.fixture = null;
    this.store = null;
    this.runtime = null;
  }

  async prepare() {
    this.fixture = await loadFixture(this.fixturePath);
    const evaluateAndAudit = async (input, phase) => {
      const started = performance.now();
      const result = await this.evaluateImplementation(input);
      this.calls.push({ phase, requestSha256: sha256(input.state.request), model: connectionMetadata().model, questionCount: Object.keys(input.questions).length, latencyMs: Number((performance.now() - started).toFixed(3)) });
      return result;
    };
    const started = performance.now();
    const incremental = await classifyRecordsIncrementally({ fixture: this.fixture, storePath: this.storePath, evaluateAndAudit: (input) => evaluateAndAudit(input, 'record') });
    this.store = incremental.store;
    this.runtime = {
      fixtureId: this.fixture.fixtureId ?? null,
      recordCount: this.fixture.records.length,
      reusedRecordCount: incremental.reusedRecordCount,
      newOrChangedRecordCount: incremental.newOrChangedRecordCount,
      classificationCalls: this.calls.filter((call) => call.phase === 'record').length,
      recordClassificationElapsedMs: Number((performance.now() - started).toFixed(3)),
    };
    return this.runtime;
  }

  async answer(question) {
    if (!this.fixture || !this.store) throw new Error('record pilot is not ready');
    const started = performance.now();
    const evaluateAndAudit = async (input) => {
      const callStarted = performance.now();
      const result = await this.evaluateImplementation(input);
      this.calls.push({ phase: 'query', requestSha256: sha256(input.state.request), model: connectionMetadata().model, questionCount: Object.keys(input.questions).length, latencyMs: Number((performance.now() - callStarted).toFixed(3)) });
      return result;
    };
    const evaluated = await classifyText(question, this.fixture, evaluateAndAudit, 'query');
    const records = searchStored(this.store, evaluated.classification);
    return {
      status: 'completed',
      answer: records.map((record) => record.rawText).join('\n\n'),
      recordIds: records.map((record) => record.id),
      elapsedMs: Number((performance.now() - started).toFixed(3)),
      recordPilot: {
        classification: evaluated.classification,
        queryClassificationCalls: 1,
        searchRecordJevCalls: 0,
      },
    };
  }

  metrics() {
    return {
      ...this.runtime,
      queryClassificationCalls: this.calls.filter((call) => call.phase === 'query').length,
      searchRecordJevCalls: 0,
      apiCalls: this.calls.length,
      calls: this.calls,
    };
  }

  async close() {}
}

export { AXES, DIRECT_ENDPOINT, DIRECT_MODEL, DIRECT_PROVIDER, FIXTURE_PATH, MODEL, loadFixture, validateFixture };

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const outputPath = process.argv[2];
  runPilot({
    fixturePath: process.env.HERMES_SEARCH_TRIAL_RECORD_PILOT_FIXTURE ?? FIXTURE_PATH,
    storePath: process.env.HERMES_SEARCH_TRIAL_RECORD_PILOT_STORE,
    outputPath,
  })
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error?.name ?? 'Error'}: ${error?.message ?? String(error)}\n`);
      process.exitCode = 1;
    });
}
