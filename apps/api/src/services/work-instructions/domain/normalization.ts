import type { WorkInstructionSourceIdentity } from './types.js';

const GRINDING_ALIASES = new Set(['研削', '研削工程']);
const CUTTING_ALIASES = new Set(['切削', '切削工程']);

/** NFKC and trim are applied at every external text boundary. */
export function normalizeWorkInstructionText(value: string): string {
  return value.normalize('NFKC').trim();
}

/**
 * Part numbers and resource codes are case-insensitive in the grouping key.
 * This deliberately does not use the production-schedule resource-category
 * policy: a resource code remains a resource code, even when that policy
 * classifies it as grinding or cutting.
 */
export function normalizeWorkInstructionPartNumber(value: string | null | undefined): string | null {
  const normalized = normalizeWorkInstructionOptionalText(value);
  return normalized ? normalized.toUpperCase() : null;
}

/**
 * Canonicalizes only the two agreed upper-level category aliases. Every other
 * value, including a machine-specific resource code, is retained as a key.
 */
export function normalizeWorkInstructionShootingTarget(value: string | null | undefined): string | null {
  const normalized = normalizeWorkInstructionOptionalText(value);
  if (!normalized) return null;
  if (GRINDING_ALIASES.has(normalized)) return '研削';
  if (CUTTING_ALIASES.has(normalized)) return '切削';
  return normalized.toUpperCase();
}

/** Attachment matching preserves the producer's exact filename and case. */
export function normalizeWorkInstructionImageName(value: string): string {
  return value;
}

/** Exact comparison key used to detect duplicate attachment filenames. */
export function workInstructionImageComparisonKey(value: string): string {
  return normalizeWorkInstructionImageName(value);
}

export function normalizeWorkInstructionSourceIdentity(
  source: WorkInstructionSourceIdentity
): WorkInstructionSourceIdentity {
  return {
    // Source identity is an external tuple. Do not NFKC/case-fold it: two
    // producers may intentionally use distinct system or list identifiers.
    system: validateSourceToken(source.system, 'source.system'),
    list: validateSourceToken(source.list, 'source.list'),
    itemId: source.itemId
  };
}

export function normalizeWorkInstructionOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = normalizeWorkInstructionText(value);
  return normalized.length > 0 ? normalized : null;
}

export function validateSourceToken(value: string, field: string): string {
  if (!value || !value.trim()) throw new Error(`${field} must not be empty`);
  return value;
}

export type WorkInstructionGroupKey = {
  partNumber: string;
  shootingTarget: string;
};

export function normalizeWorkInstructionGroupKey(
  partNumber: string | null | undefined,
  shootingTarget: string | null | undefined
): WorkInstructionGroupKey | null {
  const normalizedPartNumber = normalizeWorkInstructionPartNumber(partNumber);
  const normalizedShootingTarget = normalizeWorkInstructionShootingTarget(shootingTarget);
  if (!normalizedPartNumber || !normalizedShootingTarget) return null;
  return {
    partNumber: normalizedPartNumber,
    shootingTarget: normalizedShootingTarget
  };
}
