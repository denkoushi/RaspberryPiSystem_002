/**
 * キオスク「テンプレ候補」用の純粋ルール（DB 非依存・ユニットテスト可能）。
 */

import type { PartMeasurementProcessGroup, PartMeasurementTemplateScope } from '@prisma/client';

import { PART_MEASUREMENT_FHINMEI_CANDIDATE_MIN_LEN } from './part-measurement-constants.js';

export type PartMeasurementTemplateMatchKind =
  | 'exact_resource'
  | 'two_key_fhincd_resource'
  | 'one_key_fhinmei';

export function normalizeFhincd(raw: string): string {
  return raw.trim().toUpperCase();
}

/** 一覧の雑な表示・互換用（照合は {@link normalizeFhinmeiForMatch}） */
export function normalizeFhinmeiKey(raw: string | null | undefined): string {
  return (raw ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * FHINMEI_ONLY 照合・並び用。空白圧縮、NFKC、英字 lower。
 */
export function normalizeFhinmeiForMatch(raw: string | null | undefined): string {
  const collapsed = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (collapsed.length === 0) {
    return '';
  }
  try {
    return collapsed.normalize('NFKC').toLowerCase();
  } catch {
    return collapsed.toLowerCase();
  }
}

/** 日程品名が候補キーを含むか（FHINMEI_ONLY）。正規化後、`候補キー長 >= MIN_LEN`。 */
export function scheduleFhinmeiMatchesCandidate(
  candidateFhinmei: string | null | undefined,
  scheduleFhinmei: string | null | undefined
): boolean {
  const c = normalizeFhinmeiForMatch(candidateFhinmei);
  const s = normalizeFhinmeiForMatch(scheduleFhinmei);
  if (c.length < PART_MEASUREMENT_FHINMEI_CANDIDATE_MIN_LEN || s.length === 0) {
    return false;
  }
  return s.includes(c);
}

export function classifyCandidateMatch(params: {
  scheduleFhincdNorm: string;
  scheduleProcessGroup: PartMeasurementProcessGroup;
  scheduleResourceCdNorm: string;
  scheduleFhinmei?: string | null;
  templateScope: PartMeasurementTemplateScope;
  templateFhincdNorm: string;
  templateProcessGroup: PartMeasurementProcessGroup;
  templateResourceCdNorm: string;
  candidateFhinmei?: string | null;
}): PartMeasurementTemplateMatchKind | null {
  if (params.templateScope === 'FHINMEI_ONLY') {
    if (!scheduleFhinmeiMatchesCandidate(params.candidateFhinmei, params.scheduleFhinmei)) {
      return null;
    }
    return 'one_key_fhinmei';
  }

  const sn = params.scheduleFhincdNorm;
  const tn = params.templateFhincdNorm;
  const sr = params.scheduleResourceCdNorm;
  const tr = params.templateResourceCdNorm;

  if (params.templateScope === 'FHINCD_RESOURCE') {
    if (tn === sn && tr === sr) {
      return 'two_key_fhincd_resource';
    }
    return null;
  }

  // THREE_KEY
  if (tn !== sn) {
    return null;
  }
  if (tr === sr && params.templateProcessGroup === params.scheduleProcessGroup) {
    return 'exact_resource';
  }
  if (tr === sr && params.templateProcessGroup !== params.scheduleProcessGroup) {
    return 'two_key_fhincd_resource';
  }
  if (tr !== sr) {
    return null;
  }
  return null;
}

export function matchKindSortOrder(kind: PartMeasurementTemplateMatchKind): number {
  switch (kind) {
    case 'exact_resource':
      return 0;
    case 'two_key_fhincd_resource':
      return 1;
    case 'one_key_fhinmei':
      return 2;
    default:
      return 99;
  }
}

/**
 * 候補はいずれも選択可能。非 exact は選択後に日程の3要素キーへ複製して記録開始する。
 */
export function isSelectableForSheetCreation(matchKind: PartMeasurementTemplateMatchKind): boolean {
  void matchKind;
  return true;
}

export function compareCandidates(
  a: {
    matchKind: PartMeasurementTemplateMatchKind;
    version: number;
    updatedAtMs: number;
    /** one_key_fhinmei 同士のタイブレーク: 正規化後の候補キー長（降順で先） */
    fhinmeiNormalizedLen?: number;
  },
  b: {
    matchKind: PartMeasurementTemplateMatchKind;
    version: number;
    updatedAtMs: number;
    fhinmeiNormalizedLen?: number;
  }
): number {
  const da = matchKindSortOrder(a.matchKind);
  const db = matchKindSortOrder(b.matchKind);
  if (da !== db) return da - db;

  if (
    a.matchKind === 'one_key_fhinmei' &&
    b.matchKind === 'one_key_fhinmei' &&
    a.fhinmeiNormalizedLen != null &&
    b.fhinmeiNormalizedLen != null &&
    a.fhinmeiNormalizedLen !== b.fhinmeiNormalizedLen
  ) {
    return b.fhinmeiNormalizedLen - a.fhinmeiNormalizedLen;
  }

  if (a.version !== b.version) return b.version - a.version;
  return b.updatedAtMs - a.updatedAtMs;
}

/** 任意クエリで候補を絞り込み（品番・テンプレ名・FHINMEI候補） */
export function matchesSearchFilter(
  q: string | undefined,
  template: { fhincd: string; name: string; candidateFhinmei?: string | null }
): boolean {
  const s = normalizeFhinmeiForMatch(q);
  if (s.length === 0) return true;
  const fhinmei = normalizeFhinmeiForMatch(template.candidateFhinmei);
  const fhincd = normalizeFhinmeiForMatch(template.fhincd);
  const name = normalizeFhinmeiForMatch(template.name);
  return fhincd.includes(s) || name.includes(s) || (fhinmei.length > 0 && fhinmei.includes(s));
}
