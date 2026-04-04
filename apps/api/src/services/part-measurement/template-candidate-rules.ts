/**
 * キオスク「テンプレ候補」用の純粋ルール（DB 非依存・ユニットテスト可能）。
 */

export type PartMeasurementTemplateMatchKind =
  | 'exact_resource'
  | 'same_fhincd_other_resource'
  | 'fhinmei_similar';

export function normalizeFhincd(raw: string): string {
  return raw.trim().toUpperCase();
}

/** 品名から部分一致に使うトークン（空なら類似品番クエリをスキップ） */
export function tokenForFhinmeiSimilarSearch(fhinmei: string | undefined | null): string | null {
  const t = (fhinmei ?? '').trim();
  if (t.length < 2) return null;
  return t.slice(0, 48);
}

export function classifyTemplateMatch(params: {
  scheduleFhincdNorm: string;
  scheduleResourceCdNorm: string;
  templateFhincdNorm: string;
  templateResourceCdNorm: string;
}): PartMeasurementTemplateMatchKind {
  if (params.templateFhincdNorm !== params.scheduleFhincdNorm) {
    return 'fhinmei_similar';
  }
  if (params.templateResourceCdNorm === params.scheduleResourceCdNorm) {
    return 'exact_resource';
  }
  return 'same_fhincd_other_resource';
}

export function matchKindSortOrder(kind: PartMeasurementTemplateMatchKind): number {
  switch (kind) {
    case 'exact_resource':
      return 0;
    case 'same_fhincd_other_resource':
      return 1;
    case 'fhinmei_similar':
      return 2;
  }
}

/**
 * 候補はいずれも選択可能。品番相違（品名ヒント）も、選択後に日程の3要素キーへ複製して記録開始する。
 */
export function isSelectableForSheetCreation(matchKind: PartMeasurementTemplateMatchKind): boolean {
  void matchKind;
  return true;
}

export function compareCandidates(
  a: { matchKind: PartMeasurementTemplateMatchKind; version: number },
  b: { matchKind: PartMeasurementTemplateMatchKind; version: number }
): number {
  const da = matchKindSortOrder(a.matchKind);
  const db = matchKindSortOrder(b.matchKind);
  if (da !== db) return da - db;
  return b.version - a.version;
}

/** 任意クエリで候補を絞り込み（名前・品番） */
export function matchesSearchFilter(
  q: string | undefined,
  template: { fhincd: string; name: string }
): boolean {
  const s = (q ?? '').trim().toLowerCase();
  if (s.length === 0) return true;
  return (
    template.fhincd.toLowerCase().includes(s) || template.name.toLowerCase().includes(s)
  );
}
