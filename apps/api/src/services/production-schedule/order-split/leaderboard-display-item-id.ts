import { z } from 'zod';

/** 順位ボード表示・操作の正本 ID（未分割行は親 UUID、分割片は `split:{splitId}`）。 */
export type DisplayItemId = string;

/** 親 `CsvDashboardRow.id`。 */
export type SourceRowId = string;

/** `ProductionScheduleOrderSplit.id`。 */
export type SplitId = string;

export const SPLIT_DISPLAY_ITEM_ID_PREFIX = 'split:';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ParsedDisplayItemId =
  | { kind: 'row'; displayItemId: DisplayItemId; sourceRowId: SourceRowId }
  | {
      kind: 'split';
      displayItemId: DisplayItemId;
      sourceRowId: SourceRowId;
      splitId: SplitId;
    };

export function isUuidSourceRowId(value: string): value is SourceRowId {
  return UUID_REGEX.test(value.trim());
}

export function buildSplitDisplayItemId(splitId: SplitId): DisplayItemId {
  return `${SPLIT_DISPLAY_ITEM_ID_PREFIX}${splitId.trim()}`;
}

export function buildRowDisplayItemId(sourceRowId: SourceRowId): DisplayItemId {
  return sourceRowId.trim();
}

export function parseDisplayItemId(raw: string): ParsedDisplayItemId | null {
  const trimmed = raw.trim();
  if (!trimmed.length) return null;

  if (trimmed.startsWith(SPLIT_DISPLAY_ITEM_ID_PREFIX)) {
    const splitId = trimmed.slice(SPLIT_DISPLAY_ITEM_ID_PREFIX.length).trim();
    if (!isUuidSourceRowId(splitId)) return null;
    return {
      kind: 'split',
      displayItemId: trimmed,
      sourceRowId: '', // resolved later via DB
      splitId
    };
  }

  if (!isUuidSourceRowId(trimmed)) return null;
  return {
    kind: 'row',
    displayItemId: trimmed,
    sourceRowId: trimmed
  };
}

export function resolveUniqueSourceRowIdsFromDisplayItemIds(
  displayItemIds: readonly string[]
): SourceRowId[] {
  const seen = new Set<string>();
  const out: SourceRowId[] = [];
  for (const raw of displayItemIds) {
    const parsed = parseDisplayItemId(raw);
    if (!parsed) continue;
    if (parsed.kind === 'row') {
      if (!seen.has(parsed.sourceRowId)) {
        seen.add(parsed.sourceRowId);
        out.push(parsed.sourceRowId);
      }
      continue;
    }
    // split items: source row resolved at hydrate time; skip here for parent-exclusion heuristics
  }
  return out;
}

export function collectSplitIdsFromDisplayItemIds(displayItemIds: readonly string[]): SplitId[] {
  const out: SplitId[] = [];
  const seen = new Set<string>();
  for (const raw of displayItemIds) {
    const parsed = parseDisplayItemId(raw);
    if (parsed?.kind !== 'split') continue;
    if (seen.has(parsed.splitId)) continue;
    seen.add(parsed.splitId);
    out.push(parsed.splitId);
  }
  return out;
}

/** Zod: 未分割行 UUID または `split:{uuid}`。 */
export const displayItemIdSchema = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => parseDisplayItemId(value) != null, {
    message: 'displayItemId は UUID または split:{uuid} 形式である必要があります'
  });

export const displayItemIdParamsSchema = z.object({
  displayItemId: displayItemIdSchema
});

export const sourceRowIdParamsSchema = z.object({
  sourceRowId: z.string().uuid()
});

export const splitIdParamsSchema = z.object({
  splitId: z.string().uuid()
});
