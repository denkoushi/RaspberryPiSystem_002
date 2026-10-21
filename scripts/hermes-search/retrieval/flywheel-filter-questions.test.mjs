import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleFilterQuestions } from './flywheel-filter-questions.mjs';
import { createRandom } from './flywheel-seeds.mjs';

const catalog = { id: 'test', fields: [{ key: 'department', role: 'organization' }, { key: 'date', role: 'date' }] };
const records = ['第一部機械課', '第二部機械課', '第一部品質課', '品質部', '', null].map((department) => ({ department }));
const sample = (extra = {}) => sampleFilterQuestions({ records, catalog, count: 100, random: createRandom(42), now: '2026-10-10', ...extra });

test('sampling is deterministic, unique, uses populated catalog values, and does not mutate records', () => {
  const original = structuredClone(records);
  const rows = sample();
  assert.deepEqual(rows, sample());
  assert.notDeepEqual(sample({ count: 10 }), sample({ count: 10, random: createRandom(43) }));
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
  assert.equal(new Set(rows.map((row) => row.question)).size, rows.length);
  assert.equal(rows.length, 28);
  assert.ok(rows.every((row) => row.seed.field === 'department' && records.some((record) => record.department === row.seed.value)));
  assert.deepEqual(records, original);
  assert.deepEqual(sample({ count: 0 }), []);
  assert.deepEqual(sample({ records: [] }), []);
  assert.equal(sample({ count: 3 }).length, 3);
  assert.equal(sample({ random: () => 0 }).length, 28);
  assert.notEqual(rows[0].id, sample({ now: '2026-10-11' })[0].id);
});

test('short forms use the last organizational segment only when unique across all values', () => {
  const rows = sample().filter((row) => row.seed.template === 'short');
  for (const value of ['第一部機械課', '第二部機械課']) {
    const row = rows.find((row) => row.seed.value === value);
    assert.equal(row.seed.short, null);
    assert.equal(row.question, `${value} 最近 不適合`);
  }
  assert.equal(rows.find((row) => row.seed.value === '第一部品質課').question, '品質課 最近 不適合');
  assert.equal(rows.find((row) => row.seed.value === '第一部品質課').seed.short, '品質課');
  assert.equal(rows.find((row) => row.seed.value === '品質部').question, '品質部 最近 不適合');
  const collision = sample({ records: [{ department: '第一部品質課' }, { department: '品質課' }] });
  assert.equal(collision.find((row) => row.seed.template === 'short' && row.seed.value === '第一部品質課').seed.short, null);
});

test('period templates record inclusive calendar bounds using now, including January rollover', () => {
  const rows = sample({ now: '2026-01-10' });
  const lastMonth = rows.find((row) => row.seed.template === 'last_month');
  assert.match(lastMonth.question, /の先月の不適合$/u);
  assert.deepEqual(lastMonth.seed.period, { from: '2025-12-01', to: '2025-12-31', label: '2025-12-01..2025-12-31' });
  assert.deepEqual(rows.find((row) => row.seed.template === 'this_year').seed.period,
    { from: '2026-01-01', to: '2026-12-31', label: '2026-01-01..2026-12-31' });
  assert.ok(rows.filter((row) => !['last_month', 'this_year'].includes(row.seed.template)).every((row) => row.seed.period === null));
  assert.ok(sample({ catalog: { ...catalog, fields: catalog.fields.slice(0, 1) } }).every((row) => row.seed.period === null));
});

test('Date references share the runner night ids across Tokyo midnight and use the Tokyo period day', () => {
  const before = sample({ now: new Date('2026-12-31T14:00:00Z') });
  const after = sample({ now: new Date('2026-12-31T16:00:00Z') });
  assert.deepEqual(before.map((row) => row.id), after.map((row) => row.id));
  assert.equal(after.find((row) => row.seed.template === 'this_year').seed.period.from, '2027-01-01');
});

test('placeholder values are skipped and one-character short forms are not used', () => {
  const rows = sample({ records: [...records, { department: '*未設定部門' }, { department: '第三部門' }] });
  assert.ok(rows.every((row) => row.seed.value !== '*未設定部門'));
  assert.ok(rows.every((row) => row.question !== '門 最近 不適合'));
  const short = rows.find((row) => row.seed.template === 'short' && row.seed.value === '第三部門');
  assert.equal(short.seed.short, null);
  assert.equal(short.question, '第三部門 最近 不適合');
});

test('cause templates sample only populated categories and departments, excluding unknown', () => {
  const corpus = [{ id: 'a', department: '第一部品質課' }, { id: 'b', department: '第二部機械課' }, { id: 'c' }];
  const causeById = new Map([['a', 'drawing'], ['b', 'unknown'], ['c', 'assume'], ['absent', 'check']]);
  const options = { records: corpus, causeById };
  const rows = sample(options).filter(row => row.seed.cause);
  assert.deepEqual(rows, sample(options).filter(row => row.seed.cause));
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map(row => row.id)).size, 3);
  assert.deepEqual([...new Set(rows.map(row => row.seed.cause))].sort(), ['assume', 'drawing']);
  const recent = rows.find(row => row.seed.template === 'cause_recent');
  assert.equal(recent.question, '第一部品質課で図面・設計の誤りが原因の最近の不適合');
  assert.equal(recent.seed.value, '第一部品質課');
  for (const row of rows.filter(row => row.seed.template === 'cause_last_month')) {
    assert.equal(row.seed.field, null);
    assert.equal(row.seed.value, null);
    assert.equal(row.seed.period.from, '2026-09-01');
    assert.equal(row.seed.period.to, '2026-09-30');
    assert.match(row.question, /の不適合 先月$/u);
  }
  assert.equal(sample({ ...options, causeById: new Map() }).some(row => row.seed.cause), false);
  assert.equal(sample({ ...options, catalog: { ...catalog, fields: catalog.fields.slice(0, 1) } }).filter(row => row.seed.cause).length, 1);
});

test('breakdown templates require populated classifications and include scoped and unscoped periods', () => {
  const corpus = [{ id: 'a', department: '第一部品質課' }, { id: 'b', department: '第二部機械課' }];
  const options = { records: corpus, causeById: new Map([['a', 'drawing'], ['outside', 'check']]) };
  const rows = sample(options).filter(row => row.seed.breakdown);
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map(row => row.id)).size, 3);
  assert.deepEqual(new Set(rows.map(row => row.question)), new Set(['今年多い要因は?', '第一部品質課で今年多い要因は?', '先月の不適合の要因の内訳']));
  for (const row of rows) {
    assert.equal(row.seed.breakdown, 'cause');
    assert.equal(row.seed.cause, undefined);
    assert.equal(row.seed.period.from, row.seed.template === 'breakdown_cause_year' ? '2026-01-01' : '2026-09-01');
    assert.equal(row.seed.period.to, row.seed.template === 'breakdown_cause_year' ? '2026-12-31' : '2026-09-30');
    assert.equal(row.seed.field, row.seed.value === null ? null : 'department');
  }
  for (const causeById of [null, new Map(), new Map([['outside', 'drawing']]), new Map([['a', 'invalid']])]) {
    assert.equal(sample({ ...options, causeById }).some(row => row.seed.breakdown), false);
  }
  assert.equal(sample({ ...options, catalog: { ...catalog, fields: catalog.fields.slice(0, 1) } }).some(row => row.seed.breakdown), false);
});
