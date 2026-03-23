type FeatureRow = {
  fhincd: string;
  resourceCd: string;
  sampleCount?: number;
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

export type ActualHoursPerPieceStrategy = 'legacyP75' | 'shrinkedMedianV1';

type FeatureValue = {
  sampleCount: number;
  medianPerPieceMinutes: number;
  p75PerPieceMinutes: number | null;
};

function percentileFromSorted(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0] ?? 0;
  const position = (values.length - 1) * percentile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = values[lowerIndex] ?? values[values.length - 1] ?? 0;
  const upper = values[upperIndex] ?? values[values.length - 1] ?? 0;
  if (lowerIndex === upperIndex) return lower;
  const ratio = position - lowerIndex;
  return lower + (upper - lower) * ratio;
}

function pickPerPieceMinutes(params: {
  strategy: ActualHoursPerPieceStrategy;
  row: FeatureValue;
  resourceMedianPerPieceMinutes: number | null;
  globalMedianPerPieceMinutes: number | null;
}): number {
  if (params.strategy === 'legacyP75') {
    return params.row.p75PerPieceMinutes ?? params.row.medianPerPieceMinutes;
  }
  const sampleCount = Number.isFinite(params.row.sampleCount) ? Math.max(params.row.sampleCount, 0) : 0;
  const fallbackMedian = params.resourceMedianPerPieceMinutes ?? params.globalMedianPerPieceMinutes ?? params.row.medianPerPieceMinutes;
  const k = 3;
  const weight = sampleCount / (sampleCount + k);
  return weight * params.row.medianPerPieceMinutes + (1 - weight) * fallbackMedian;
}

export function createActualHoursFeatureResolver(params: {
  features: FeatureRow[];
  resourceCodeMappings?: ResourceCodeMappingRow[];
  resourceGroupCandidatesByResourceCd?: Record<string, string[]>;
  strategy?: ActualHoursPerPieceStrategy;
}): ActualHoursFeatureResolver {
  const strategy = params.strategy ?? 'shrinkedMedianV1';
  const featureMap = new Map<string, FeatureValue>();
  const resourceMedianValues = new Map<string, number[]>();
  const globalMedianValues: number[] = [];
  for (const row of params.features) {
    const fhincd = normalizeKeyPart(row.fhincd);
    const resourceCd = normalizeKeyPart(row.resourceCd);
    if (!fhincd || !resourceCd) continue;
    const sampleCount =
      typeof row.sampleCount === 'number' && Number.isFinite(row.sampleCount)
        ? Math.max(0, Math.floor(row.sampleCount))
        : 1;
    const featureValue: FeatureValue = {
      sampleCount,
      medianPerPieceMinutes: row.medianPerPieceMinutes,
      p75PerPieceMinutes: row.p75PerPieceMinutes,
    };
    featureMap.set(`${fhincd}__${resourceCd}`, featureValue);
    const current = resourceMedianValues.get(resourceCd) ?? [];
    const repeatCount = Math.min(Math.max(sampleCount, 1), 1000);
    for (let i = 0; i < repeatCount; i += 1) {
      current.push(row.medianPerPieceMinutes);
      globalMedianValues.push(row.medianPerPieceMinutes);
    }
    resourceMedianValues.set(resourceCd, current);
  }
  const resourceMedianMap = new Map<string, number>();
  for (const [resourceCd, medians] of resourceMedianValues.entries()) {
    const sorted = medians.slice().sort((a, b) => a - b);
    resourceMedianMap.set(resourceCd, percentileFromSorted(sorted, 0.5));
  }
  const globalMedianPerPieceMinutes =
    globalMedianValues.length > 0
      ? percentileFromSorted(globalMedianValues.slice().sort((a, b) => a - b), 0.5)
      : null;

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

      const strictRow = featureMap.get(`${normalizedFhincd}__${normalizedResourceCd}`);
      if (strictRow !== undefined) {
        return {
          perPieceMinutes: pickPerPieceMinutes({
            strategy,
            row: strictRow,
            resourceMedianPerPieceMinutes: resourceMedianMap.get(normalizedResourceCd) ?? null,
            globalMedianPerPieceMinutes,
          }),
          matchedBy: 'strict',
          matchedResourceCd: normalizedResourceCd
        };
      }

      const candidates = mappingMap.get(normalizedResourceCd) ?? [];
      for (const candidate of candidates) {
        const mappedRow = featureMap.get(`${normalizedFhincd}__${candidate}`);
        if (mappedRow !== undefined) {
          return {
            perPieceMinutes: pickPerPieceMinutes({
              strategy,
              row: mappedRow,
              resourceMedianPerPieceMinutes: resourceMedianMap.get(candidate) ?? null,
              globalMedianPerPieceMinutes,
            }),
            matchedBy: 'mapped',
            matchedResourceCd: candidate
          };
        }
      }

      const groupedCandidates = groupMap.get(normalizedResourceCd) ?? [];
      for (const candidate of groupedCandidates) {
        if (candidate === normalizedResourceCd) continue;
        const groupedRow = featureMap.get(`${normalizedFhincd}__${candidate}`);
        if (groupedRow !== undefined) {
          return {
            perPieceMinutes: pickPerPieceMinutes({
              strategy,
              row: groupedRow,
              resourceMedianPerPieceMinutes: resourceMedianMap.get(candidate) ?? null,
              globalMedianPerPieceMinutes,
            }),
            matchedBy: 'grouped',
            matchedResourceCd: candidate
          };
        }
      }

      return { perPieceMinutes: null, matchedBy: null, matchedResourceCd: null };
    }
  };
}
