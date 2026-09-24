// Offline enrichment contract. Query time never calls DGX.
import { createHash } from 'node:crypto';
import { catalogEntries } from './catalog.mjs';

export const ENRICHMENT_SCHEMA_VERSION = 1;
export const ENRICHMENT_ALIAS_SCHEMA_VERSION = 2;
export const MAX_ALIASES = 12;
export const MAX_ALTS = 6;
export const STORE_SCHEMA = 'hermes-retrieval-enrichment/v1';
export const STATUS_SCHEMA = 'hermes-retrieval-enrichment-status/v1';
export const FACET_KEYS = Object.freeze(['phenomenon', 'cause', 'process', 'part', 'treatment']);

const facetItem = {
  type: 'object',
  additionalProperties: false,
  required: ['value', 'evidence'],
  properties: {
    value: { type: 'string', minLength: 1, maxLength: 80 },
    evidence: { type: 'string', minLength: 1, maxLength: 500 },
  },
};

export const ENRICHMENT_JSON_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['facets', 'queries', 'summary'],
  properties: {
    facets: {
      type: 'object',
      additionalProperties: false,
      required: [...FACET_KEYS],
      properties: Object.fromEntries(FACET_KEYS.map((key) => [key, {
        type: 'array',
        maxItems: 8,
        items: facetItem,
      }])),
    },
    queries: {
      type: 'array',
      minItems: 3,
      maxItems: 5,
      items: { type: 'string', minLength: 1, maxLength: 120 },
    },
    summary: { type: 'string', minLength: 1, maxLength: 60 },
    aliases: {
      type: 'array',
      maxItems: MAX_ALIASES,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['term', 'alts'],
        properties: {
          term: { type: 'string', minLength: 1, maxLength: 80 },
          alts: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_ALTS,
            items: { type: 'string', minLength: 1, maxLength: 20 },
          },
        },
      },
    },
  },
});

export function normalizeText(value) {
  return String(value ?? '').normalize('NFKC');
}

export function charLength(value) {
  return Array.from(String(value ?? '')).length;
}

export function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function catalogFieldLines(catalog) {
  return catalogEntries(catalog).flatMap((entry) => entry.fields.map((field) => (
    `${field.label}（${field.key}、役割: ${field.role}）`
  )));
}

export function promptTemplate(catalog) {
  return [
    'あなたは現場記録の検索補助です。入力は1件の記録です。',
    '記録番号や管理IDを質問文に書かないでください。',
    'facets は phenomenon, cause, process, part, treatment です。各要素は value と evidence です。',
    'evidence は入力本文に実際にある連続した文字列だけを使い、言い換えないでください。根拠が無い種類は空配列です。',
    'queries は、現場の人がこの記録を探すときに打ちそうな自然な日本語の質問を3件から5件です。',
    'そのうち2件以上は、記録本文の語ではなく aliases の alts にある言い方を使ってください。',
    'aliases は {term, alts} の配列です。term は入力本文にある連続した文字列だけです。',
    'alts は、同じものを指す別の呼び方です。同義語、現場の口語、上位の分類語、カタカナ・漢字・英語のゆれ、現象の擬音です。',
    '各 alt は20文字以内で1件から6件、記録本文に含まれる文字列にしてはいけません。aliases は最大12件です。',
    '分類表や分野辞書は使わず、その記録の語から一般的な言い換えだけを出してください。',
    'summary は1行で60文字以内です。入力に無い事実は足さないでください。',
    '出力はJSONオブジェクトだけです。',
    '項目の意味:',
    ...catalogFieldLines(catalog),
  ].join('\n');
}

export function promptSha256(catalog) {
  return sha256Text(promptTemplate(catalog));
}

export function recordText(record, catalog) {
  const lines = [];
  for (const entry of catalogEntries(catalog)) {
    for (const field of entry.fields) {
      const value = record?.[field.key];
      if (typeof value !== 'string' || !value.trim()) continue;
      lines.push(`${field.label}: ${value}`);
    }
  }
  return lines.join('\n');
}

export function sourceRecordHash(record, catalog) {
  const payload = {};
  for (const entry of catalogEntries(catalog)) {
    for (const field of entry.fields) {
      const value = record?.[field.key];
      if (typeof value === 'string') payload[field.key] = value;
    }
  }
  return sha256Text(JSON.stringify(payload));
}

function asObject(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/u);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

export function parseEnrichmentPayload(raw) {
  const value = asObject(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('enrichment payload must be an object');
  }
  if (!value.facets || typeof value.facets !== 'object' || Array.isArray(value.facets)) {
    throw new TypeError('enrichment facets are required');
  }
  const facets = {};
  for (const key of FACET_KEYS) {
    const items = value.facets[key];
    if (!Array.isArray(items)) throw new TypeError(`facet ${key} must be an array`);
    facets[key] = items.map((item) => {
      if (!item || typeof item !== 'object') throw new TypeError('facet item must be an object');
      if (typeof item.value !== 'string' || !item.value.trim()) throw new TypeError('facet value is required');
      if (typeof item.evidence !== 'string' || !item.evidence) throw new TypeError('facet evidence is required');
      if (charLength(item.value) > 80 || charLength(item.evidence) > 500) throw new TypeError('facet item is too long');
      return { value: item.value.trim(), evidence: item.evidence };
    });
    if (facets[key].length > 8) throw new TypeError(`facet ${key} has too many items`);
  }
  if (!Array.isArray(value.queries)) throw new TypeError('queries must be an array');
  const queries = value.queries.map((query) => {
    if (typeof query !== 'string' || !query.trim()) throw new TypeError('query must be text');
    if (charLength(query.trim()) > 120) throw new TypeError('query is too long');
    return query.trim();
  });
  if (queries.length < 3 || queries.length > 5) throw new TypeError('queries must contain 3 to 5 items');
  if (typeof value.summary !== 'string' || !value.summary.trim()) throw new TypeError('summary is required');
  if (value.summary.includes('\n') || charLength(value.summary.trim()) > 60) throw new TypeError('summary must be one line of at most 60 characters');
  return { facets, queries, summary: value.summary.trim(), aliases: parseAliases(value.aliases) };
}

function parseAliases(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new TypeError('aliases must be an array');
  if (raw.length > MAX_ALIASES) throw new TypeError('aliases has too many items');
  return raw.map((item) => {
    if (!item || typeof item !== 'object') throw new TypeError('alias item must be an object');
    if (typeof item.term !== 'string' || !item.term.trim()) throw new TypeError('alias term is required');
    if (charLength(item.term.trim()) > 80) throw new TypeError('alias term is too long');
    if (!Array.isArray(item.alts) || item.alts.length < 1 || item.alts.length > MAX_ALTS) {
      throw new TypeError('alias alts must contain 1 to 6 items');
    }
    const alts = item.alts.map((alt) => {
      if (typeof alt !== 'string' || !alt.trim()) throw new TypeError('alias alt must be text');
      if (charLength(alt.trim()) > 20) throw new TypeError('alias alt is too long');
      return alt.trim();
    });
    return { term: item.term.trim(), alts };
  });
}

export function verifyEvidence(parsed, sourceText, recordId = '') {
  const source = normalizeText(sourceText);
  const id = String(recordId ?? '');
  let evidenceDropped = 0;
  let evidenceKept = 0;
  const facets = {};
  for (const key of FACET_KEYS) {
    facets[key] = [];
    for (const item of parsed.facets[key]) {
      if (!source.includes(normalizeText(item.evidence))) {
        evidenceDropped += 1;
        continue;
      }
      evidenceKept += 1;
      facets[key].push(item);
    }
  }
  const queries = parsed.queries.filter((query) => !id || !query.includes(id));
  if (queries.length < 3) throw new TypeError('queries lost the record identifier constraint');
  const aliasResult = verifyAliases(parsed.aliases ?? [], source);
  const expanded = queries.filter((query) => queryUsesAlt(query, aliasResult.aliases)).length;
  if ((parsed.aliases ?? []).length > 0 && expanded < 2) {
    throw new TypeError('at least 2 queries must use alias alternatives');
  }
  return {
    facets,
    queries: queries.slice(0, 5),
    summary: parsed.summary,
    aliases: aliasResult.aliases,
    evidenceDropped,
    evidenceKept,
    aliasesDropped: aliasResult.aliasesDropped,
    aliasesKept: aliasResult.aliasesKept,
    enrichmentSchemaVersion: aliasResult.aliases.length ? ENRICHMENT_ALIAS_SCHEMA_VERSION : ENRICHMENT_SCHEMA_VERSION,
  };
}

function verifyAliases(aliases, source) {
  const kept = [];
  let aliasesDropped = 0;
  for (const alias of aliases) {
    if (!source.includes(normalizeText(alias.term))) {
      aliasesDropped += 1;
      continue;
    }
    const alts = [];
    for (const alt of alias.alts) {
      const normalized = normalizeText(alt);
      if (!normalized || source.includes(normalized) || normalized === normalizeText(alias.term)) {
        aliasesDropped += 1;
        continue;
      }
      if (!alts.some((item) => normalizeText(item) === normalized)) alts.push(alt);
    }
    if (!alts.length) {
      aliasesDropped += 1;
      continue;
    }
    kept.push({ term: alias.term, alts: alts.slice(0, MAX_ALTS) });
  }
  return {
    aliases: kept.slice(0, MAX_ALIASES),
    aliasesDropped,
    aliasesKept: Math.min(kept.length, MAX_ALIASES),
  };
}

function queryUsesAlt(query, aliases) {
  const text = normalizeText(query);
  return aliases.some((alias) => alias.alts.some((alt) => text.includes(normalizeText(alt)) && !text.includes(normalizeText(alias.term))));
}

export function toRetrievalEnrichment(stored) {
  const tags = [];
  for (const key of FACET_KEYS) {
    for (const item of stored?.facets?.[key] ?? []) {
      if (typeof item?.value === 'string' && item.value) tags.push(item.value);
    }
  }
  for (const alias of stored?.aliases ?? []) {
    for (const alt of alias?.alts ?? []) {
      if (typeof alt === 'string' && alt && !tags.includes(alt)) tags.push(alt);
    }
  }
  return {
    summary: typeof stored?.summary === 'string' ? stored.summary : '',
    queries: Array.isArray(stored?.queries) ? stored.queries.filter((query) => typeof query === 'string') : [],
    tags,
  };
}

export function attachEnrichment(records, byId) {
  if (!byId || byId.size === 0) return records;
  return records.map((record) => {
    const stored = byId.get(record?.id);
    if (!stored) return record;
    return { ...record, enrichment: toRetrievalEnrichment(stored) };
  });
}
