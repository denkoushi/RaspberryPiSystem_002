import test from 'node:test';
import assert from 'node:assert/strict';
import { STYLES, createRandom, pickWeighted, sampleSeed, sampleSeeds } from './flywheel-seeds.mjs';
import { PAIR_MAX_SIMILARITY, PAIR_MAX_TEXT_OVERLAP, answerableIntents, bodyText, samplePairs, textOverlap } from './flywheel-pairs.mjs';
import {
  QUESTION_MAX_CHARS, buildMessages, copyViolation, createDgxChat, generateForPairs, generateQuestion, recordFacts, validateQuestion,
} from './flywheel-generate.mjs';
import { parseArgs } from './flywheel-cli.mjs';

function unit(values) {
  const norm = Math.hypot(...values);
  return Float32Array.from(values.map((value) => value / norm));
}

const records = [
  { id: 'a1', originDepartmentName: 'North Shop', partName: 'Table', condition: 'clamp was loose', remarks: 'surface scratch on the table top', disposition: 'repolished' },
  { id: 'b1', originDepartmentName: 'North Shop', partName: 'Column', condition: 'tool hit the part', remarks: 'dent on the column face', disposition: 'remade' },
  { id: 'c1', originDepartmentName: 'South Shop', partName: 'Table', condition: 'paint was thin', remarks: 'paint peeled off', correctiveContent: 'check paint thickness' },
  { id: 'd1', originDepartmentName: 'East Shop', partName: 'Bolt', condition: 'wrong length ordered', remarks: 'bolt too long' },
  { id: 'dup', originDepartmentName: 'North Shop', partName: 'Table', condition: 'clamp was loose', remarks: 'surface scratch on the table top', disposition: 'repolished' },
  { id: 'empty', originDepartmentName: 'North Shop', partName: 'Table' },
  { id: 'sister', originDepartmentName: 'West Shop', partName: 'Pump', remarks: 'the elbow adapter is smaller than the tee port on the coolant line', disposition: 'used a bushing from stock' },
  { id: 'sister2', originDepartmentName: 'West Shop', partName: 'Pump', condition: 'chose the wrong adapter size', remarks: 'the elbow adapter is smaller than the tee port on the coolant line', disposition: 'used a bushing from stock' },
];
const denseEntries = [
  { id: 'nonconformity:a1', vector: unit([1, 0.2, 0]) },
  { id: 'nonconformity:b1', vector: unit([1, 0.6, 0]) },
  { id: 'nonconformity:c1', vector: unit([0.9, 0.1, 0.4]) },
  { id: 'nonconformity:d1', vector: unit([0, 0, 1]) },
  { id: 'nonconformity:dup', vector: unit([1, 0.2, 0]) },
  { id: 'nonconformity:sister', vector: unit([0, 1, 0.3]) },
  { id: 'nonconformity:sister2', vector: unit([0, 1, 0.4]) },
];

test('seeds repeat for a fixed random seed and follow the style weights', () => {
  assert.deepEqual(sampleSeeds({ count: 5, random: createRandom(7) }), sampleSeeds({ count: 5, random: createRandom(7) }));
  const random = createRandom(11);
  const counts = {};
  for (let index = 0; index < 4000; index += 1) {
    const style = pickWeighted(STYLES, random).id;
    counts[style] = (counts[style] ?? 0) + 1;
  }
  // terse 50%, colloquial 20%, kana 15%, typo 15%, within sampling noise.
  assert.ok(Math.abs(counts.terse / 4000 - 0.5) < 0.04);
  assert.ok(Math.abs(counts.colloquial / 4000 - 0.2) < 0.04);
  const seed = sampleSeed({ random, allowedIntents: ['disposition'] });
  assert.equal(seed.intent, 'disposition');
  assert.equal(sampleSeed({ random, allowedIntents: [] }), null);
});

test('a pair joins a record to its nearest similar record in the same context', () => {
  assert.deepEqual(answerableIntents(records[3]).sort(), ['cause', 'phenomenon', 'similar']);
  assert.equal(bodyText(records[5]), '');
  const pairs = samplePairs({ records, denseEntries, count: 10, random: createRandom(3) });
  const byA = Object.fromEntries(pairs.map((pair) => [pair.a, pair]));
  // a1 and dup share text, so a1 pairs with b1 (same shop), not with its copy.
  assert.equal(byA.a1.b, 'b1');
  // c1 shares only the part name with a1 and dup; d1 shares nothing, so it has no pair.
  assert.ok(['a1', 'dup'].includes(byA.c1.b));
  assert.equal(byA.d1, undefined);
  // Two reports of the same event on sister machines overlap in wording and are never paired.
  assert.ok(textOverlap(bodyText(records[6]), bodyText(records[7])) > PAIR_MAX_TEXT_OVERLAP);
  assert.equal(byA.sister, undefined);
  assert.equal(byA.sister2, undefined);
  for (const pair of pairs) assert.ok(pair.similarity <= PAIR_MAX_SIMILARITY);
  assert.equal(new Set(pairs.map((pair) => pair.a)).size, pairs.length);
  const again = samplePairs({ records, denseEntries, count: 10, random: createRandom(3) });
  assert.deepEqual(again, pairs);
  const skipped = samplePairs({ records, denseEntries, count: 10, random: createRandom(3), exclude: new Set(['a1']) });
  assert.equal(skipped.some((pair) => pair.a === 'a1'), false);
});

test('facts are short field phrases and copied questions are rejected', () => {
  const facts = recordFacts({ ...records[0], condition: `${'x'.repeat(80)}。second sentence` });
  assert.match(facts, /品名: Table/u);
  assert.match(facts, /不適合内容: x{60}…/u);
  assert.doesNotMatch(facts, /second sentence/u);
  const body = 'テーブル上面に傷がついた。クランプが緩んでいた。';
  assert.equal(copyViolation('テーブル上面に傷がついた件', body), 'copied_run');
  assert.equal(copyViolation('テーブルのキズ 前にもあった？', body), null);
  assert.equal(validateQuestion('', body), 'empty');
  assert.equal(validateQuestion('あ'.repeat(QUESTION_MAX_CHARS + 1), body), 'too_long');
  assert.equal(validateQuestion('00008226 の件', body), 'record_number');
  assert.equal(validateQuestion('キズ 不適合', body), null);
});

test('the prompt names the seed and never sends the full record', () => {
  const messages = buildMessages({ seed: { intent: 'cause', style: 'terse', role: 'inspector' }, factsA: 'A facts', factsB: 'B facts' });
  assert.match(messages[0].content, /検査員/u);
  assert.match(messages[0].content, /なぜ起きたか/u);
  assert.match(messages[0].content, /2〜6語/u);
  assert.equal(messages[1].content, '記録A:\nA facts\n\n記録B:\nB facts');
});

test('generation keeps valid questions and reports why others were dropped', async () => {
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const replies = [
    { ok: true, content: JSON.stringify({ question: 'テーブル キズ クランプ' }) },
    { ok: true, content: JSON.stringify({ question: 'surface scratch on the table top again?' }) },
    { ok: true, content: 'not json' },
    { ok: false, reason: 'timeout' },
  ];
  let calls = 0;
  const chat = async ({ messages, schema, temperature }) => {
    assert.equal(messages.length, 2);
    assert.deepEqual(schema.required, ['question']);
    assert.equal(temperature, 0.7);
    return replies[calls++];
  };
  const pairs = [{ a: 'a1', b: 'b1' }, { a: 'a1', b: 'b1' }, { a: 'a1', b: 'b1' }, { a: 'a1', b: 'b1' }, { a: 'missing', b: 'b1' }];
  const rows = await generateForPairs({
    pairs, recordsById, random: createRandom(5), chat, sampleSeed, answerableIntents, bodyText,
  });
  assert.deepEqual(rows.map((row) => row.ok ? row.question : row.reason), [
    'テーブル キズ クランプ', 'copied_run', 'invalid_json', 'timeout', 'no_seed',
  ]);
  assert.equal(calls, 4);
  assert.equal(rows.every((row) => !('text' in row)), true);
  const single = await generateQuestion({
    seed: { intent: 'phenomenon', style: 'kana', role: 'worker' }, recordA: records[0], recordB: records[1], anchorBody: bodyText(records[0]),
    chat: async () => ({ ok: true, content: JSON.stringify({ question: 'キズ' }) }),
  });
  assert.deepEqual(single, { ok: true, question: 'キズ' });
});

test('the DGX adapter posts the consultation route and maps failures', async () => {
  const seen = [];
  const chat = createDgxChat({
    origin: 'http://dgx.example:8000/',
    token: 'test-token',
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      if (seen.length === 1) return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: '{"question":"q"}' } }] }) };
      if (seen.length === 2) return { ok: true, text: async () => JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '' } }] }) };
      return { ok: false, status: 503, text: async () => '' };
    },
  });
  assert.deepEqual(await chat({ messages: [], schema: { type: 'object' } }), { ok: true, content: '{"question":"q"}' });
  assert.equal(seen[0].url, 'http://dgx.example:8000/v1/chat/completions');
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.model, 'system-prod-primary');
  assert.equal(body.chat_template_kwargs.enable_thinking, false);
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(seen[0].init.headers.authorization, 'Bearer test-token');
  assert.deepEqual(await chat({ messages: [] }), { ok: false, reason: 'truncated' });
  assert.deepEqual(await chat({ messages: [] }), { ok: false, reason: 'http_503' });
  assert.throws(() => createDgxChat({ origin: '', token: '' }), /not configured/u);
});

test('the offline CLI accepts only the pairs mode with its inputs', () => {
  assert.deepEqual(parseArgs(['pairs', '--snapshot', 's.json', '--dense', 'd.bin', '--count', '5', '--seed', '9']), {
    mode: 'pairs', snapshot: 's.json', dense: 'd.bin', count: 5, seed: 9,
  });
  assert.throws(() => parseArgs(['pairs', '--snapshot', 's.json']), /Usage/u);
  assert.throws(() => parseArgs(['generate']), /Usage/u);
});
