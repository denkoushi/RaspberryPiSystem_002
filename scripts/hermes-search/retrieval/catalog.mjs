// Derive a source-neutral catalog entry from a hermes-source-definition/v1
// document. Role rules are structural (key and label shape). Source-specific
// names stay in the definition data, not in the planner or executor.
import { readFileSync } from 'node:fs';
import { nonconformityDefinition } from '../hermes-source-definition.mjs';

const sourceLabels = JSON.parse(readFileSync(new URL('./source-labels.json', import.meta.url), 'utf8'));

const DATE_KEY = /(?:On|Date|At)$/u;
const ORGANIZATION_KEY = /department|organization|orgunit/iu;
const DATE_LABEL = /日$/u;
const ORGANIZATION_LABEL = /部署|組織/u;

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function traitsFor(key, label, kind, isIdentifier) {
  if (kind === 'body') return { role: 'body', filterable: false, enumerated: false };
  if (isIdentifier) return { role: 'identifier', filterable: true, enumerated: true };
  if (DATE_KEY.test(key) || DATE_LABEL.test(label)) return { role: 'date', filterable: true, enumerated: false };
  if (ORGANIZATION_KEY.test(key) || ORGANIZATION_LABEL.test(label)) {
    return { role: 'organization', filterable: true, enumerated: true };
  }
  return { role: 'facet', filterable: true, enumerated: true };
}

export function deriveCatalog(definition) {
  if (!definition || typeof definition !== 'object' || typeof definition.id !== 'string' || !definition.id) {
    throw new TypeError('source definition id is required');
  }
  const metadata = definition.metadataFields ?? {};
  const body = definition.bodyFields ?? {};
  const identifierKey = definition.recordNumberField ?? null;
  const fields = [];
  const seen = new Set();
  const add = (key, label, kind) => {
    if (!key || typeof label !== 'string' || !label || seen.has(key)) return;
    seen.add(key);
    const traits = traitsFor(key, label, kind, key === identifierKey);
    fields.push({ key, label, role: traits.role, filterable: traits.filterable, enumerated: traits.enumerated });
  };
  for (const [key, label] of Object.entries(metadata)) add(key, label, 'metadata');
  for (const [key, label] of Object.entries(body)) add(key, label, 'body');
  const labeled = typeof definition.label === 'string' && definition.label ? definition.label : sourceLabels[definition.id];
  const description = typeof definition.description === 'string' && definition.description.trim()
    ? definition.description.trim()
    : (typeof labeled === 'string' && labeled ? labeled : definition.id);
  const valueChoiceCap = Number.isInteger(definition.valueChoiceCap) && definition.valueChoiceCap > 0
    ? definition.valueChoiceCap
    : 300;
  return freeze({
    schema: 'hermes-source-catalog/v1',
    id: definition.id,
    label: typeof labeled === 'string' && labeled ? labeled : definition.id,
    description,
    valueChoiceCap,
    fields,
  });
}

export function loadNonconformityCatalog() {
  return deriveCatalog(nonconformityDefinition);
}

export function catalogEntries(catalog) {
  if (Array.isArray(catalog)) return catalog;
  if (catalog && Array.isArray(catalog.fields) && typeof catalog.id === 'string') return [catalog];
  if (catalog && Array.isArray(catalog.entries)) return catalog.entries;
  throw new TypeError('catalog must be an entry or a list of entries');
}

export function fieldsWithRole(catalog, role) {
  return catalogEntries(catalog).flatMap((entry) => entry.fields.filter((field) => field.role === role).map((field) => field.key));
}
