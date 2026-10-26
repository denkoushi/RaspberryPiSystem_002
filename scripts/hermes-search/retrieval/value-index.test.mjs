import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, loadNonconformityCatalog } from './catalog.mjs';
import { records } from './fixtures/synthetic-records.mjs';
import { buildValueIndex, choiceValuesForField, enumeratedChoiceGroups, findCandidateValues, hierarchyGroups, normalizeForMatch } from './value-index.mjs';

const catalog = loadNonconformityCatalog();

test('same-named values are kept in their source, including legacy source-less nonconformities', () => {
  const index = buildValueIndex([
    { id: 'legacy', partNumber: 'N0' },
    { id: 'n1', sourceId: 'nonconformity', partNumber: 'N1' },
    { id: 'p1', sourceId: 'knowledge_procedure', partNumber: 'P1' },
  ], loadCatalog(['nonconformity', 'knowledge_procedure']));
  assert.deepEqual(index.values.nonconformity.partNumber, ['N0', 'N1']);
  assert.deepEqual(index.values.knowledge_procedure.partNumber, ['P1']);
});

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

test('organization values yield hierarchy prefixes that cover two or more units', () => {
  const values = ['東工場製造部機械課', '東工場製造部組立課', '東工場品質保証部', '西工場製造部', '西工場製造部（加工）', '本社営業部', '部品管理課'];
  const groups = hierarchyGroups(values);
  assert.deepEqual(groups.map((group) => [group.prefix, group.values.length]).sort(), [
    ['東工場', 3],
    ['東工場製造部', 2],
    ['西工場', 2],
    ['西工場製造部', 2],
  ].sort());
  // A prefix that is itself a value keeps that value beneath it.
  assert.deepEqual(groups.find((group) => group.prefix === '西工場製造部').values, ['西工場製造部', '西工場製造部（加工）']);
  // A single-unit prefix and a bare suffix never form a group.
  assert.equal(groups.some((group) => group.prefix === '本社営業部' || group.prefix === '部'), false);

  const indexed = buildValueIndex(values.map((name, index) => ({ id: `h-${index}`, originDepartmentName: name, machineName: '東工場製造部機械課' })), catalog);
  const choice = enumeratedChoiceGroups('東工場の類例', indexed, catalog);
  const department = choice.find((group) => group.field === 'originDepartmentName');
  assert.equal(department.hierarchy.length, 4);
  // Only organization fields get hierarchy choices.
  assert.equal(choice.find((group) => group.field === 'machineName').hierarchy, undefined);
});
