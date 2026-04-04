/**
 * キオスク「テンプレ候補」用の純粋ルール（DB 非依存・ユニットテスト可能）。
 */

import type { PartMeasurementProcessGroup, PartMeasurementTemplateScope } from '@prisma/client';

export type PartMeasurementTemplateMatchKind =
  | 'exact_resource'
  | 'two_key_fhincd_resource'
  | 'one_key_fhinmei';

export function normalizeFhincd(raw: string): string {
  return raw.trim().toUpperCase();
}

export function normalizeFhinmeiKey(raw: string | null | undefined): string {
  return (raw ?? '').trim().replace(/\s+/g, ' ');
}

/** 日程品名と候補 FHINMEI キーが一致するか（大文字小文字無視・前後空白除去） */
export function scheduleFhinmeiMatchesCandidate(
  candidateFhinmei: string | null | undefined,
  scheduleFhinmei: string | null | undefined
): boolean {
  const c = normalizeFhinmeiKey(candidateFhinmei);
  const s = normalizeFhinmeiKey(scheduleFhinmei);
  if (c.length === 0 || s.length === 0) return false;
  return c.localeCompare(s, undefined, { sensitivity: 'accent' }) === 0;
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
  },
  b: {
    matchKind: PartMeasurementTemplateMatchKind;
    version: number;
    updatedAtMs: number;
  }
): number {
  const da = matchKindSortOrder(a.matchKind);
  const db = matchKindSortOrder(b.matchKind);
  if (da !== db) return da - db;
  if (a.version !== b.version) return b.version - a.version;
  return b.updatedAtMs - a.updatedAtMs;
}

/** 任意クエリで候補を絞り込み（品番・テンプレ名・FHINMEI候補） */
export function matchesSearchFilter(
  q: string | undefined,
  template: { fhincd: string; name: string; candidateFhinmei?: string | null }
): boolean {
  const s = (q ?? '').trim().toLowerCase();
  if (s.length === 0) return true;
  const fhinmei = (template.candidateFhinmei ?? '').trim().toLowerCase();
  return (
    template.fhincd.toLowerCase().includes(s) ||
    template.name.toLowerCase().includes(s) ||
    (fhinmei.length > 0 && fhinmei.includes(s))
  );
}
