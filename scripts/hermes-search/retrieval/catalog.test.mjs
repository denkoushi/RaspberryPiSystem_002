import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveCatalog, loadCatalog, loadNonconformityCatalog } from './catalog.mjs';
import { nonconformityDefinition } from '../hermes-source-definition.mjs';

test('loadCatalog preserves source order and derives procedure roles and labels', () => {
  const entries = loadCatalog(['knowledge_procedure', 'nonconformity']);
  assert.deepEqual(entries.map((entry) => entry.id), ['knowledge_procedure', 'nonconformity']);
  assert.equal(entries[0].label, '手順書');
  assert.equal(entries[0].fields.find((field) => field.key === 'title').role, 'identifier');
  assert.equal(entries[0].fields.find((field) => field.key === 'publishedOn').role, 'date');
  assert.deepEqual(entries[0].fields.filter((field) => field.role === 'body').map((field) => field.key), ['stepsText', 'cautionsText']);
  assert.ok(Object.isFrozen(entries[0].fields));
  assert.deepEqual(entries[0].visibility, ['kiosk', 'viewer', 'manager', 'admin']);
  assert.ok(Object.isFrozen(entries[0].visibility));
});

test('deriveCatalog copies source visibility independently of the definition', () => {
  const definition = { ...nonconformityDefinition, visibility: ['admin'] };
  const entry = deriveCatalog(definition);
  assert.deepEqual(entry.visibility, ['admin']);
  assert.notEqual(entry.visibility, definition.visibility);
  definition.visibility.push('viewer');
  assert.deepEqual(entry.visibility, ['admin']);
});

test('the nonconformity loader stays compatible and unknown source ids fail', () => {
  assert.deepEqual(loadNonconformityCatalog(), deriveCatalog(nonconformityDefinition));
  assert.deepEqual(loadCatalog(['nonconformity'])[0], loadNonconformityCatalog());
  assert.throws(() => loadCatalog(['constructor']), { message: 'unknown retrieval source: constructor' });
});
