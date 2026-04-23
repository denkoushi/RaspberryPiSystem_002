import type { MiInstrumentEntry, MiInstrumentKind } from './mi-instrument-display.types.js';
import { MI_INSTRUMENT_DETAIL_COLUMN } from './mi-instrument-display.types.js';
import type { MiLoanInspectionTableRow } from './row-priority.js';

const LEGACY_TOKEN = /^(.+?)\s*\(([^)]+)\)\s*$/u;

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseKind(value: unknown): MiInstrumentKind {
  if (value === 'returned') {
    return 'returned';
  }
  return 'active';
}

/**
 * レガシー列 `計測機器名称一覧`（カンマ区切り `名称 (管理番号)`）から active エントリを復元。
 */
export function parseLegacyInstrumentList(namesText: string): MiInstrumentEntry[] {
  const raw = String(namesText ?? '').trim();
  if (!raw) {
    return [];
  }
  const tokens = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const out: MiInstrumentEntry[] = [];
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

/**
 * 新列 `計測機器明細`（JSON 配列）を優先。空・不正時はレガシー列で復元。
 */
export function parseRowInstrumentEntries(row: MiLoanInspectionTableRow): MiInstrumentEntry[] {
  const jsonCol = asTrimmedString(row[MI_INSTRUMENT_DETAIL_COLUMN]);
  if (jsonCol) {
    try {
      const parsed: unknown = JSON.parse(jsonCol);
      if (Array.isArray(parsed)) {
        const entries: MiInstrumentEntry[] = [];
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
          return entries;
        }
      }
    } catch {
      /* fall through to legacy */
    }
  }
  return parseLegacyInstrumentList(String(row['計測機器名称一覧'] ?? ''));
}
