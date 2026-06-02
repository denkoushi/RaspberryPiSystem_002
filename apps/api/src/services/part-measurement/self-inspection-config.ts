/**
 * 自主検査モードの正本契約（KB-320 §自主検査 拡張）。
 *
 * - full / single / first_last / fixed_count
 * - fixed_count のみ selfInspectionFixedCount 必須
 * - first_last は plannedQuantity >= 2 のみ。entryIndex は 0 と plannedQuantity-1
 * - 既存 DB の SAMPLE は FIXED_COUNT + fixedCount へ読み替え
 */
import type { SelfInspectionEntrySlotKind, SelfInspectionMode } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';

/** 自主検査の必要件数・指示数の上限（API Zod `plannedQuantity` と整合） */
export const SELF_INSPECTION_MAX_EXPECTED_ENTRY_COUNT = 2000;

export type SelfInspectionModeDto = 'full' | 'single' | 'first_last' | 'fixed_count';

export type SelfInspectionEntrySlotKindDto = 'single' | 'first' | 'last' | 'fixed';

export type SelfInspectionTemplateConfig = {
  selfInspectionMode: SelfInspectionMode;
  selfInspectionFixedCount: number | null;
  /** @deprecated migration 互換。未設定時は fixedCount を参照 */
  selfInspectionSampleSize?: number | null;
};

export type RequiredEntrySlot = {
  entryIndex: number;
  entrySlotKind: SelfInspectionEntrySlotKindDto;
  entrySlotLabel: string;
};

export function normalizeSelfInspectionPlannedQuantity(plannedQuantity: number): number {
  return Math.max(Math.floor(plannedQuantity), 1);
}

export function resolveTemplateFixedCount(template: SelfInspectionTemplateConfig): number | null {
  if (template.selfInspectionFixedCount != null) {
    return template.selfInspectionFixedCount;
  }
  return template.selfInspectionSampleSize ?? null;
}

export function normalizeDbSelfInspectionMode(mode: SelfInspectionMode): SelfInspectionMode {
  if (mode === 'SAMPLE') {
    return 'FIXED_COUNT';
  }
  return mode;
}

export function serializeSelfInspectionMode(mode: SelfInspectionMode): SelfInspectionModeDto {
  switch (normalizeDbSelfInspectionMode(mode)) {
    case 'SINGLE':
      return 'single';
    case 'FIRST_LAST':
      return 'first_last';
    case 'FIXED_COUNT':
      return 'fixed_count';
    case 'FULL':
    default:
      return 'full';
  }
}

export function parseSelfInspectionModeDto(mode: SelfInspectionModeDto): SelfInspectionMode {
  switch (mode) {
    case 'single':
      return 'SINGLE';
    case 'first_last':
      return 'FIRST_LAST';
    case 'fixed_count':
      return 'FIXED_COUNT';
    case 'full':
    default:
      return 'FULL';
  }
}

export function serializeEntrySlotKind(kind: SelfInspectionEntrySlotKind): SelfInspectionEntrySlotKindDto {
  switch (kind) {
    case 'FIRST':
      return 'first';
    case 'LAST':
      return 'last';
    case 'SINGLE':
      return 'single';
    case 'FIXED':
    default:
      return 'fixed';
  }
}

export function entrySlotLabelFromKind(
  kind: SelfInspectionEntrySlotKindDto,
  entryIndex?: number
): string {
  switch (kind) {
    case 'first':
      return '最初';
    case 'last':
      return '最終';
    case 'single':
      return '1件';
    case 'fixed':
    default:
      return entryIndex != null ? String(entryIndex + 1) : '';
  }
}

export function isFullSelfInspectionPlannedQuantityWithinLimit(plannedQuantity: number): boolean {
  return normalizeSelfInspectionPlannedQuantity(plannedQuantity) <= SELF_INSPECTION_MAX_EXPECTED_ENTRY_COUNT;
}

export const SELF_INSPECTION_FULL_MODE_PLANNED_QUANTITY_LIMIT_MESSAGE = `全数検査は指示数が${SELF_INSPECTION_MAX_EXPECTED_ENTRY_COUNT}件以下の場合のみ開始できます`;

export type ValidateSelfInspectionConfigInput = {
  mode: SelfInspectionModeDto;
  fixedCount?: number | null;
  plannedQuantity?: number | null;
};

export function validateSelfInspectionConfigFromDb(
  mode: SelfInspectionMode,
  fixedCount: number | null | undefined,
  sampleSize?: number | null,
  plannedQuantity?: number | null
): { mode: SelfInspectionMode; fixedCount: number | null } {
  return validateSelfInspectionConfig({
    mode: serializeSelfInspectionMode(mode),
    fixedCount: fixedCount ?? sampleSize ?? null,
    plannedQuantity
  });
}

export type SelfInspectionReviseBodyPatch = {
  selfInspectionMode?: SelfInspectionModeDto | 'sample';
  selfInspectionFixedCount?: number | null;
  selfInspectionSampleSize?: number | null;
};

export function hasSelfInspectionReviseBodyPatch(body: SelfInspectionReviseBodyPatch): boolean {
  return (
    body.selfInspectionMode !== undefined ||
    body.selfInspectionFixedCount !== undefined ||
    body.selfInspectionSampleSize !== undefined
  );
}

/**
 * 改版 API 用: 自主検査フィールドが無いときは undefined（service 側で source 継承）。
 * mode 未指定のパッチでは full に落とさない。
 */
export function selfInspectionPatchFromReviseBody(body: SelfInspectionReviseBodyPatch):
  | {
      selfInspectionMode?: SelfInspectionMode;
      selfInspectionFixedCount?: number | null;
      selfInspectionSampleSize?: number | null;
    }
  | undefined {
  if (!hasSelfInspectionReviseBodyPatch(body)) {
    return undefined;
  }
  if (body.selfInspectionMode !== undefined) {
    const modeDto: SelfInspectionModeDto =
      body.selfInspectionMode === 'sample' ? 'fixed_count' : body.selfInspectionMode;
    const validated = validateSelfInspectionConfig({
      mode: modeDto,
      fixedCount: body.selfInspectionFixedCount ?? body.selfInspectionSampleSize ?? null
    });
    return {
      selfInspectionMode: validated.mode,
      selfInspectionFixedCount: validated.fixedCount
    };
  }
  return {
    selfInspectionFixedCount: body.selfInspectionFixedCount,
    selfInspectionSampleSize: body.selfInspectionSampleSize
  };
}

/** 改版時: `undefined` は未指定（継承）、`null` は明示クリア */
export function resolveReviseSelfInspectionFields(
  body: {
    selfInspectionMode?: SelfInspectionMode;
    selfInspectionFixedCount?: number | null;
    selfInspectionSampleSize?: number | null;
  },
  source: SelfInspectionTemplateConfig
): { mode: SelfInspectionMode; fixedCount: number | null } {
  const mode = body.selfInspectionMode ?? source.selfInspectionMode;

  let fixedCount: number | null;
  if (body.selfInspectionFixedCount !== undefined) {
    fixedCount = body.selfInspectionFixedCount;
  } else if (body.selfInspectionSampleSize !== undefined) {
    fixedCount = body.selfInspectionSampleSize;
  } else if (body.selfInspectionMode !== undefined) {
    const normalized = normalizeDbSelfInspectionMode(mode);
    fixedCount =
      normalized === 'FIXED_COUNT' ? (resolveTemplateFixedCount(source) ?? null) : null;
  } else {
    fixedCount = resolveTemplateFixedCount(source);
  }

  return validateSelfInspectionConfigFromDb(mode, fixedCount);
}

export function validateSelfInspectionConfig(input: ValidateSelfInspectionConfigInput): {
  mode: SelfInspectionMode;
  fixedCount: number | null;
} {
  const mode = parseSelfInspectionModeDto(input.mode);
  const fixedCount =
    input.fixedCount !== undefined && input.fixedCount !== null
      ? Math.floor(input.fixedCount)
      : null;
  const planned =
    input.plannedQuantity != null ? normalizeSelfInspectionPlannedQuantity(input.plannedQuantity) : null;

  if (mode === 'FIXED_COUNT') {
    if (fixedCount == null || fixedCount < 1) {
      throw new ApiError(400, '指定数検査では検査数が必須です');
    }
    if (fixedCount > SELF_INSPECTION_MAX_EXPECTED_ENTRY_COUNT) {
      throw new ApiError(400, `指定数は${SELF_INSPECTION_MAX_EXPECTED_ENTRY_COUNT}以下である必要があります`);
    }
    if (planned != null && fixedCount > planned) {
      throw new ApiError(400, '指定数は指示数以下である必要があります');
    }
    return { mode, fixedCount };
  }

  if (mode === 'FIRST_LAST') {
    if (fixedCount != null) {
      throw new ApiError(400, '最初と最後の検査では指定数を設定できません');
    }
    if (planned != null && planned < 2) {
      throw new ApiError(400, '最初と最後の検査は指示数が2以上の場合のみ利用できます');
    }
    return { mode, fixedCount: null };
  }

  if (mode === 'SINGLE') {
    if (fixedCount != null) {
      throw new ApiError(400, '抜き取り1個では指定数を設定できません');
    }
    return { mode, fixedCount: null };
  }

  if (fixedCount != null) {
    throw new ApiError(400, '全数検査では指定数を設定できません');
  }
  if (planned != null && !isFullSelfInspectionPlannedQuantityWithinLimit(planned)) {
    throw new ApiError(400, SELF_INSPECTION_FULL_MODE_PLANNED_QUANTITY_LIMIT_MESSAGE);
  }
  return { mode: 'FULL', fixedCount: null };
}

export function tryResolveExpectedEntryCount(
  template: SelfInspectionTemplateConfig,
  plannedQuantity: number
): number | null {
  const mode = normalizeDbSelfInspectionMode(template.selfInspectionMode);
  const normalizedPlanned = normalizeSelfInspectionPlannedQuantity(plannedQuantity);

  if (mode === 'FULL') {
    if (!isFullSelfInspectionPlannedQuantityWithinLimit(normalizedPlanned)) {
      return null;
    }
    return normalizedPlanned;
  }
  if (mode === 'SINGLE') {
    return 1;
  }
  if (mode === 'FIRST_LAST') {
    if (normalizedPlanned < 2) {
      return null;
    }
    return 2;
  }
  const fixed = resolveTemplateFixedCount(template) ?? 0;
  if (fixed < 1 || fixed > normalizedPlanned) {
    return null;
  }
  return fixed;
}

export function listRequiredEntrySlots(
  template: SelfInspectionTemplateConfig,
  plannedQuantity: number
): RequiredEntrySlot[] {
  const mode = normalizeDbSelfInspectionMode(template.selfInspectionMode);
  const normalizedPlanned = normalizeSelfInspectionPlannedQuantity(plannedQuantity);
  const expected = tryResolveExpectedEntryCount(template, plannedQuantity);
  if (expected == null) {
    return [];
  }

  if (mode === 'FIRST_LAST') {
    return [
      { entryIndex: 0, entrySlotKind: 'first', entrySlotLabel: '最初' },
      {
        entryIndex: normalizedPlanned - 1,
        entrySlotKind: 'last',
        entrySlotLabel: '最終'
      }
    ];
  }
  if (mode === 'SINGLE') {
    return [{ entryIndex: 0, entrySlotKind: 'single', entrySlotLabel: '1件' }];
  }

  const count = expected;
  return Array.from({ length: count }, (_, i) => ({
    entryIndex: i,
    entrySlotKind: 'fixed' as const,
    entrySlotLabel: String(i + 1)
  }));
}

export function assertEntryIndexAllowed(
  template: SelfInspectionTemplateConfig,
  plannedQuantity: number,
  entryIndex: number
): RequiredEntrySlot {
  const slots = listRequiredEntrySlots(template, plannedQuantity);
  const hit = slots.find((s) => s.entryIndex === entryIndex);
  if (!hit) {
    throw new ApiError(400, '入力件番号が範囲外です');
  }
  return hit;
}

export function inferEntrySlotKindForIndex(
  template: SelfInspectionTemplateConfig,
  plannedQuantity: number,
  entryIndex: number
): SelfInspectionEntrySlotKind {
  const slot = assertEntryIndexAllowed(template, plannedQuantity, entryIndex);
  switch (slot.entrySlotKind) {
    case 'first':
      return 'FIRST';
    case 'last':
      return 'LAST';
    case 'single':
      return 'SINGLE';
    case 'fixed':
    default:
      return 'FIXED';
  }
}

export function countRequiredSlotsFilled(
  template: SelfInspectionTemplateConfig,
  plannedQuantity: number,
  entryIndicesPresent: number[]
): number {
  const required = listRequiredEntrySlots(template, plannedQuantity);
  const present = new Set(entryIndicesPresent);
  return required.filter((s) => present.has(s.entryIndex)).length;
}

export function isSessionCompletionReady(
  template: SelfInspectionTemplateConfig,
  plannedQuantity: number,
  entryIndicesPresent: number[]
): boolean {
  const required = listRequiredEntrySlots(template, plannedQuantity);
  if (required.length === 0) {
    return false;
  }
  return countRequiredSlotsFilled(template, plannedQuantity, entryIndicesPresent) >= required.length;
}
