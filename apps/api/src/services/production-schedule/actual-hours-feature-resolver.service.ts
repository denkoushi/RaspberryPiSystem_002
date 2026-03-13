type FeatureRow = {
  fhincd: string;
  resourceCd: string;
  medianPerPieceMinutes: number;
  p75PerPieceMinutes: number | null;
};

type ResourceCodeMappingRow = {
  fromResourceCd: string;
  toResourceCd: string;
  priority: number;
  enabled: boolean;
};

export type ActualHoursFeatureResolveResult = {
  perPieceMinutes: number | null;
  matchedBy: 'strict' | 'mapped' | 'grouped' | null;
  matchedResourceCd: string | null;
};

export interface ActualHoursFeatureResolver {
  resolve(params: { fhincd: string; resourceCd: string }): ActualHoursFeatureResolveResult;
}

const normalizeKeyPart = (value: string): string => value.trim().toUpperCase();

export function createActualHoursFeatureResolver(params: {
  features: FeatureRow[];
  resourceCodeMappings?: ResourceCodeMappingRow[];
  resourceGroupCandidatesByResourceCd?: Record<string, string[]>;
}): ActualHoursFeatureResolver {
  const featureMap = new Map<string, number>();
  for (const row of params.features) {
    const fhincd = normalizeKeyPart(row.fhincd);
    const resourceCd = normalizeKeyPart(row.resourceCd);
    if (!fhincd || !resourceCd) continue;
    featureMap.set(`${fhincd}__${resourceCd}`, row.p75PerPieceMinutes ?? row.medianPerPieceMinutes);
  }

  const mappingMap = new Map<string, string[]>();
  for (const row of params.resourceCodeMappings ?? []) {
    if (!row.enabled) continue;
    const fromResourceCd = normalizeKeyPart(row.fromResourceCd);
    const toResourceCd = normalizeKeyPart(row.toResourceCd);
    if (!fromResourceCd || !toResourceCd) continue;
    const current = mappingMap.get(fromResourceCd) ?? [];
    current.push(toResourceCd);
    mappingMap.set(fromResourceCd, current);
  }

  const groupMap = new Map<string, string[]>();
  for (const [resourceCd, candidates] of Object.entries(params.resourceGroupCandidatesByResourceCd ?? {})) {
    const normalizedResourceCd = normalizeKeyPart(resourceCd);
    if (!normalizedResourceCd) continue;
    const normalizedCandidates = Array.from(
      new Set(candidates.map((candidate) => normalizeKeyPart(candidate)).filter((candidate) => candidate.length > 0))
    );
    if (normalizedCandidates.length === 0) continue;
    groupMap.set(normalizedResourceCd, normalizedCandidates);
  }

  return {
    resolve({ fhincd, resourceCd }) {
      const normalizedFhincd = normalizeKeyPart(fhincd);
      const normalizedResourceCd = normalizeKeyPart(resourceCd);
      if (!normalizedFhincd || !normalizedResourceCd) {
        return { perPieceMinutes: null, matchedBy: null, matchedResourceCd: null };
      }

      const strictValue = featureMap.get(`${normalizedFhincd}__${normalizedResourceCd}`);
      if (strictValue !== undefined) {
        return {
          perPieceMinutes: strictValue,
          matchedBy: 'strict',
          matchedResourceCd: normalizedResourceCd
        };
      }

      const candidates = mappingMap.get(normalizedResourceCd) ?? [];
      for (const candidate of candidates) {
        const mappedValue = featureMap.get(`${normalizedFhincd}__${candidate}`);
        if (mappedValue !== undefined) {
          return {
            perPieceMinutes: mappedValue,
            matchedBy: 'mapped',
            matchedResourceCd: candidate
          };
        }
      }

      const groupedCandidates = groupMap.get(normalizedResourceCd) ?? [];
      for (const candidate of groupedCandidates) {
        if (candidate === normalizedResourceCd) continue;
        const groupedValue = featureMap.get(`${normalizedFhincd}__${candidate}`);
        if (groupedValue !== undefined) {
          return {
            perPieceMinutes: groupedValue,
            matchedBy: 'grouped',
            matchedResourceCd: candidate
          };
        }
      }

      return { perPieceMinutes: null, matchedBy: null, matchedResourceCd: null };
    }
  };
}
