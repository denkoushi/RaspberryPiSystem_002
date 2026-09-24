import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveCatalog, loadNonconformityCatalog } from './catalog.mjs';
import { records } from './fixtures/synthetic-records.mjs';
import { QUERY_PLAN_SCHEMA, validateQueryPlan } from './query-plan.mjs';
import { buildValueIndex } from './value-index.mjs';

const catalog = loadNonconformityCatalog();
const valueIndex = buildValueIndex(records, catalog);

function plan(overrides = {}) {
  return {
    schema: QUERY_PLAN_SCHEMA,
    sources: ['nonconformity'],
    filters: [],
    semanticQuery: '',
    sort: 'relevance',
    limit: 5,
    display: ['condition'],
    unresolved: [],
    ...overrides,
  };
}

test('catalog roles come from the source definition shape', () => {
  const byKey = Object.fromEntries(catalog.fields.map((field) => [field.key, field]));
  assert.equal(byKey.nonconformityNo.role, 'identifier');
  assert.equal(byKey.nonconformityNo.filterable, true);
  assert.equal(byKey.originDepartmentName.role, 'organization');
  assert.equal(byKey.machineName.role, 'facet');
  assert.equal(byKey.discoveredOn.role, 'date');
  assert.equal(byKey.discoveredOn.enumerated, false);
  assert.equal(byKey.condition.role, 'body');
  assert.equal(byKey.condition.filterable, false);
  const synthetic = deriveCatalog({
    id: 'inventory',
    recordNumberField: 'sku',
    metadataFields: { sku: 'SKU', updatedOn: 'Updated', color: 'Color' },
    bodyFields: { note: 'Note' },
  });
  const roles = Object.fromEntries(synthetic.fields.map((field) => [field.key, field.role]));
  assert.deepEqual(roles, { sku: 'identifier', updatedOn: 'date', color: 'facet', note: 'body' });
});

test('validator accepts an indexed filter and rejects unknown source, field, op, value, and unresolved terms', () => {
  const accepted = validateQueryPlan(plan({
    filters: [{ source: 'nonconformity', field: 'originDepartmentName', op: 'eq', values: ['North Shop'] }],
    sort: { field: 'discoveredOn', direction: 'desc' },
    limit: 2,
  }), catalog, valueIndex);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.plan.filters[0].values[0], 'North Shop');

  const unknownSource = validateQueryPlan(plan({ sources: ['other'] }), catalog, valueIndex);
  assert.equal(unknownSource.ok, false);
  assert.match(unknownSource.clarification.message, /unknown source/);

  const unknownField = validateQueryPlan(plan({
    filters: [{ source: 'nonconformity', field: 'notAField', op: 'eq', values: ['x'] }],
  }), catalog, valueIndex);
  assert.equal(unknownField.ok, false);
  assert.match(unknownField.clarification.message, /unknown field/);

  const unknownOp = validateQueryPlan(plan({
    filters: [{ source: 'nonconformity', field: 'machineName', op: 'like', values: ['Lathe-1'] }],
  }), catalog, valueIndex);
  assert.equal(unknownOp.ok, false);
  assert.match(unknownOp.clarification.message, /unknown op/);

  const missingValue = validateQueryPlan(plan({
    filters: [{ source: 'nonconformity', field: 'originDepartmentName', op: 'eq', values: ['Missing Shop'] }],
  }), catalog, valueIndex);
  assert.equal(missingValue.ok, false);
  assert.match(missingValue.clarification.message, /not in the index/);
  assert.equal(missingValue.clarification.candidates[0].term, 'Missing Shop');

  const unresolved = validateQueryPlan(plan({
    unresolved: [{ term: 'shop', candidates: ['North Shop', 'South Shop'] }],
  }), catalog, valueIndex);
  assert.equal(unresolved.ok, false);
  assert.deepEqual(unresolved.clarification.candidates, [{ term: 'shop', candidates: ['North Shop', 'South Shop'] }]);

  assert.equal(validateQueryPlan(plan({ limit: 0 }), catalog, valueIndex).ok, false);
  assert.equal(validateQueryPlan(plan({ limit: 21 }), catalog, valueIndex).ok, false);
  assert.equal(validateQueryPlan(plan({
    filters: [{ source: 'nonconformity', field: 'condition', op: 'eq', values: ['paint drip'] }],
  }), catalog, valueIndex).ok, false);
});
