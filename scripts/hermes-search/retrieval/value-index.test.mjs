import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNonconformityCatalog } from './catalog.mjs';
import { records } from './fixtures/synthetic-records.mjs';
import { buildValueIndex, choiceValuesForField, findCandidateValues, normalizeForMatch } from './value-index.mjs';

const catalog = loadNonconformityCatalog();

test('value index keeps distinct enumerated values and finds normalized substrings', () => {
  const withWidth = [...records, {
    ...records[0],
    id: 'rec-width',
    nonconformityNo: 'SYN-005',
    originDepartmentName: 'Ｎｏｒｔｈ Ｓｈｏｐ',
    machineName: 'Lathe-1',
  }];
  const index = buildValueIndex(withWidth, catalog);
  const departments = index.values.nonconformity.originDepartmentName;
  assert.deepEqual(departments, ['North Shop', 'South Shop']);
  assert.equal(index.values.nonconformity.condition, undefined);
  assert.ok(index.values.nonconformity.machineName.includes('Lathe-1'));
  assert.equal(normalizeForMatch('Ｎｏｒｔｈ Ｓｈｏｐ'), normalizeForMatch('North Shop'));

  const full = findCandidateValues('Show North Shop issues', index, catalog);
  const departmentHit = full.find((group) => group.field === 'originDepartmentName');
  assert.equal(departmentHit.term, 'North Shop');
  assert.deepEqual(departmentHit.values, ['North Shop']);
  assert.equal(full.some((group) => group.field === 'condition'), false);

  const partial = findCandidateValues('which shop had a gap', index, catalog);
  const shops = partial.find((group) => group.field === 'originDepartmentName');
  assert.deepEqual(shops.values, ['North Shop', 'South Shop']);

  const machine = findCandidateValues('Lathe stopped', index, catalog);
  assert.deepEqual(machine.find((group) => group.field === 'machineName').values, ['Lathe-1']);
});

test('choice values keep a short list and prefilter a long list by bigrams plus shared tokens', () => {
  const short = ['Alpha Plant Machining', 'Beta Plant Assembly'];
  assert.deepEqual(choiceValuesForField('Alpha Plant Machining', short, { cap: 300 }), short);
  const long = Array.from({ length: 12 }, (_, index) => `other-value-${index}`);
  long.push('Alpha Plant Manufacturing Machining');
  long.push('sharedtoken only');
  const picked = choiceValuesForField('Alpha Plant Machining sharedtoken', long, { cap: 8, topK: 3 });
  assert.equal(picked.includes('Alpha Plant Manufacturing Machining'), true);
  assert.equal(picked.includes('sharedtoken only'), true);
  assert.equal(picked.length < long.length, true);
});
