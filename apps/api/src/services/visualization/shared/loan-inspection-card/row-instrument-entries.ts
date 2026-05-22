import type {
  LoanInspectionInstrumentEntry,
  LoanInspectionInstrumentKind,
  LoanInspectionTableRow,
} from './display.types.js';

const LEGACY_TOKEN = /^(.+?)\s*\(([^)]+)\)\s*$/u;

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseKind(value: unknown): LoanInspectionInstrumentKind {
  if (value === 'returned') {
    return 'returned';
  }
  return 'active';
}

function normalizeEntryOrder(entries: readonly LoanInspectionInstrumentEntry[]): LoanInspectionInstrumentEntry[] {
  const actives = entries.filter((e) => e.kind === 'active');
  const returneds = entries.filter((e) => e.kind === 'returned');
  return [...actives, ...returneds];
}

export function parseLegacyInstrumentList(namesText: string): LoanInspectionInstrumentEntry[] {
  const raw = String(namesText ?? '').trim();
  if (!raw) {
    return [];
  }
  const tokens = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const out: LoanInspectionInstrumentEntry[] = [];
  for (const token of tokens) {
    const m = token.match(LEGACY_TOKEN);
    if (m) {
      const name = m[1]!.trim();
      const managementNumber = m[2]!.trim();
      if (name) {
        out.push({ kind: 'active', managementNumber, name });
      }
      continue;
    }
    out.push({ kind: 'active', managementNumber: '', name: token });
  }
  return out;
}

export function parseRowInstrumentEntries(
  row: LoanInspectionTableRow,
  columns: { detailColumn: string; namesColumn: string },
): LoanInspectionInstrumentEntry[] {
  const jsonCol = asTrimmedString(row[columns.detailColumn]);
  if (jsonCol) {
    try {
      const parsed: unknown = JSON.parse(jsonCol);
      if (Array.isArray(parsed)) {
        const entries: LoanInspectionInstrumentEntry[] = [];
        for (const item of parsed) {
          if (!isRecord(item)) {
            continue;
          }
          const kind = parseKind(item.kind);
          const managementNumber = asTrimmedString(item.managementNumber);
          const name = asTrimmedString(item.name);
          if (!managementNumber && !name) {
            continue;
          }
          entries.push({ kind, managementNumber, name });
        }
        if (entries.length > 0) {
          return normalizeEntryOrder(entries);
        }
      }
    } catch {
      /* fall through to legacy */
    }
  }
  return normalizeEntryOrder(parseLegacyInstrumentList(String(row[columns.namesColumn] ?? '')));
}
