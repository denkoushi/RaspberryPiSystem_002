import { normalizeMachineName } from '../productionSchedule/machineName';

import type { HaizenOverviewRow } from '../../../api/domains/mobile-placement';

export const searchKinds = { machineName: '機種名', fhincd: '品番', fseiban: '製番' } as const;
export type HaizenSearchKind = keyof typeof searchKinds;
export type HaizenSearch = { kind: HaizenSearchKind; text: string };

export function normalizeHaizenSearch(value: string): string {
  return value.normalize('NFKC').toUpperCase().replace(/[\s\-‐‑‒–—―−]/g, '');
}

export function searchValue(row: HaizenOverviewRow, kind: HaizenSearchKind): string {
  return kind === 'machineName' ? normalizeMachineName(row.machineName, { maxChars: Infinity }) : row[kind] ?? '';
}

export function matchesHaizenSearch(row: HaizenOverviewRow, query: HaizenSearch): boolean {
  const needle = normalizeHaizenSearch(query.text);
  return needle.length > 0 && normalizeHaizenSearch(searchValue(row, query.kind)).includes(needle);
}

export function parseHaizenSpeech(speech: string, rows: HaizenOverviewRow[]): HaizenSearch | null {
  const text = speech.normalize('NFKC').trim().replace(/[。．.!！?？]+$/, '').trim();
  const prefix = /^(機種名|機種|品番|製番)\s*[:：]?\s*(.*)$/.exec(text);
  if (prefix) {
    const kind = prefix[1].startsWith('機種') ? 'machineName' : prefix[1] === '品番' ? 'fhincd' : 'fseiban';
    return normalizeHaizenSearch(prefix[2]) ? { kind, text: prefix[2] } : null;
  }
  for (const kind of ['fseiban', 'fhincd', 'machineName'] as const) {
    if (rows.some(row => matchesHaizenSearch(row, { kind, text }))) return { kind, text };
  }
  return null;
}

export function timeSincePlaced(updatedAt: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(updatedAt)) / 60_000));
  if (minutes < 60) return `${minutes}分前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}時間前`;
  return `${Math.floor(minutes / 1440)}日前`;
}
