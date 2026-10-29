import { normalizePartSearchQuery } from './normalize.js';
import { buildTokenGroupsForSearch } from './token-groups.js';

export type PartSearchRow = {
  id: string;
  shelfCodeRaw: string | null;
  fseiban: string;
  fhincd: string;
  fhinmei: string;
  productNo: string;
  machineName: string;
  manufacturingOrder?: string;
  branchNo?: number;
};
export type PartSearchField = 'seiban' | 'hinban' | 'machine' | 'name';
export type PartSearchFilter = { field: PartSearchField; value: string };
export type PartSearchQuery = { field: 'all' | PartSearchField; typed: string; filters: PartSearchFilter[] };
export type PartSearchFacet = PartSearchFilter & { count: number };
const fields: PartSearchField[] = ['seiban', 'hinban', 'machine', 'name'];
const rowKeys = { seiban: 'fseiban', hinban: 'fhincd', machine: 'machineName', name: 'fhinmei' } as const;
type IndexedRow = { row: PartSearchRow; comparable: Record<PartSearchField, string> };
export type PartSearchIndex = readonly IndexedRow[];
const comparable = (value: string) => normalizePartSearchQuery(value).toUpperCase();
const compare = (a: string, b: string) => a.localeCompare(b, 'ja');

/** Rebuild only when rows change; keystrokes never normalize row data. */
export function buildPartSearchIndex(rows: readonly PartSearchRow[]): PartSearchIndex {
  return rows.map((row) => ({ row, comparable: {
    seiban: comparable(row.fseiban), hinban: comparable(row.fhincd),
    machine: comparable(row.machineName), name: comparable(row.fhinmei)
  } }));
}

function groupsFor(typed: string): string[][] {
  return buildTokenGroupsForSearch(typed).tokenGroups.map((group) => group.map((term) => term.toUpperCase()));
}
function passesFilters(entry: IndexedRow, filters: PartSearchFilter[]): boolean {
  // Facets select an exact source value, not another substring query.
  return filters.every((filter) => entry.row[rowKeys[filter.field]] === filter.value);
}
function matches(values: string[], groups: string[][]): boolean {
  return groups.every((group) => group.some((term) => values.some((value) => value.includes(term))));
}

export function searchPartIndex(index: PartSearchIndex, query: PartSearchQuery): {
  hits: PartSearchRow[]; facets: PartSearchFacet[]; total: number;
} {
  const active = query.field === 'all' ? fields : [query.field];
  const groups = groupsFor(query.typed);
  const entries = index.filter((entry) => passesFilters(entry, query.filters)
    && matches(active.map((field) => entry.comparable[field]), groups));
  const ranked = entries.map((entry) => ({ ...entry,
    shelf: Number(Boolean(entry.row.shelfCodeRaw?.trim())),
    prefix: Number(groups.some((group) => group.some((term) => active.some((field) => entry.comparable[field].startsWith(term)))))
  }));
  ranked.sort((a, b) => b.shelf - a.shelf || b.prefix - a.prefix
    || compare(a.row.fseiban, b.row.fseiban) || compare(a.row.fhincd, b.row.fhincd) || compare(a.row.id, b.row.id));

  // With no text, the mock offers machine facets first, then seiban.
  const facetFields = query.field === 'all' && groups.length === 0
    ? [query.filters.some((filter) => filter.field === 'machine') ? 'seiban' as const : 'machine' as const]
    : active;
  const facets = new Map<string, PartSearchFacet>();
  for (const entry of entries) {
    for (const field of facetFields) {
      if (query.field === 'all' && groups.length > 0 && !matches([entry.comparable[field]], groups)) continue;
      const value = entry.row[rowKeys[field]];
      if (!value) continue;
      const key = JSON.stringify([field, value]);
      const facet = facets.get(key);
      if (facet) facet.count++;
      else facets.set(key, { field, value, count: 1 });
    }
  }
  return {
    hits: ranked.map((entry) => entry.row), total: entries.length,
    facets: [...facets.values()].sort((a, b) => b.count - a.count || compare(a.value, b.value) || compare(a.field, b.field))
  };
}

type TermTrie = { next: Map<string, TermTrie>; groups: number[] };
const trieNode = (): TermTrie => ({ next: new Map(), groups: [] });

/**
 * Compile all candidate queries into one term trie and scan each filtered row once.
 * Unlike inspecting only current hits, this also handles alias expansion introduced
 * by the next key (ア → アシ can newly match 脚), whitespace and yoon rewrites.
 * Cost follows the row text and term lengths, not rows × keys full searches.
 */
export function nextKeyAvailability(index: PartSearchIndex, query: PartSearchQuery, candidateKeys: string[]): Set<string> {
  const keys = [...new Set(candidateKeys)];
  const available = new Set<string>();
  const trie = trieNode();
  const groupIds = new Map<string, number>();
  const owners: number[][] = [];
  const required = keys.map((key, candidate) => {
    const groups = groupsFor(query.typed + key);
    for (const group of groups) {
      const signature = JSON.stringify([...new Set(group)].sort());
      let id = groupIds.get(signature);
      if (id === undefined) {
        id = owners.length;
        groupIds.set(signature, id);
        owners.push([]);
        for (const term of new Set(group)) {
          let node = trie;
          for (const char of term) {
            let next = node.next.get(char);
            if (!next) { next = trieNode(); node.next.set(char, next); }
            node = next;
          }
          node.groups.push(id);
        }
      }
      owners[id].push(candidate);
    }
    return groups.length;
  });
  const active = query.field === 'all' ? fields : [query.field];
  for (const entry of index) {
    if (!passesFilters(entry, query.filters)) continue;
    const seen = new Set<number>();
    const counts = new Uint32Array(keys.length);
    // Keys that add no search term are available once any row passes the filters.
    required.forEach((count, i) => { if (count === 0) available.add(keys[i]); });
    for (const field of active) {
      const chars = [...entry.comparable[field]];
      for (let start = 0; start < chars.length; start++) {
        let node = trie;
        for (let end = start; end < chars.length; end++) {
          const next = node.next.get(chars[end]);
          if (!next) break;
          node = next;
          for (const group of node.groups) {
            if (seen.has(group)) continue;
            seen.add(group);
            for (const candidate of owners[group]) {
              if (++counts[candidate] === required[candidate]) available.add(keys[candidate]);
            }
          }
        }
      }
    }
    if (available.size === keys.length) break;
  }
  return available;
}
