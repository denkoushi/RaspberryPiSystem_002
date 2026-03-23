import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import {
  createActualHoursFeatureResolver,
  type ActualHoursFeatureResolver,
  type ActualHoursPerPieceStrategy,
} from '../actual-hours-feature-resolver.service.js';
import {
  pickActualHoursRowsByLocationPriority,
  resolveActualHoursLocationCandidates,
} from '../actual-hours-location-scope.service.js';
import { getResourceGroupCandidatesByResourceCds } from '../resource-master.service.js';

type FeatureRowWithLocation = {
  location: string;
  fhincd: string;
  resourceCd: string;
  sampleCount: number;
  medianPerPieceMinutes: number;
  p75PerPieceMinutes: number | null;
};

type ResourceCodeMappingRow = {
  fromResourceCd: string;
  toResourceCd: string;
  priority: number;
  enabled: boolean;
};

const normalizeKeyPart = (value: string): string => value.trim().toUpperCase();

export type ActualHoursReadContext = {
  locationCandidates: string[];
  resolver: ActualHoursFeatureResolver;
  selectedFeatureCount: number;
  fetchedFeatureCountByLocation: Record<string, number>;
  resourceCodeMappingCount: number;
  getSampleCountForResolved(params: { fhincd: string; matchedResourceCd: string | null }): number;
};

export async function loadActualHoursReadContext(params: {
  locationKey: string;
  resourceCds?: string[];
  strategy?: ActualHoursPerPieceStrategy;
}): Promise<ActualHoursReadContext> {
  const actualHoursLocationCandidates = resolveActualHoursLocationCandidates(params.locationKey);
  const normalizedResourceCds = Array.from(
    new Set(
      (params.resourceCds ?? [])
        .map((resourceCd) => resourceCd.trim())
        .filter((resourceCd) => resourceCd.length > 0)
    )
  );

  const [featureRowsWithLocation, resourceCodeMappings, resourceGroupCandidatesByResourceCd] = await Promise.all([
    prisma.productionScheduleActualHoursFeature.findMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: { in: actualHoursLocationCandidates },
      },
      select: {
        location: true,
        fhincd: true,
        resourceCd: true,
        sampleCount: true,
        medianPerPieceMinutes: true,
        p75PerPieceMinutes: true,
      },
    }),
    prisma.productionScheduleResourceCodeMapping.findMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: params.locationKey,
        enabled: true,
      },
      orderBy: [{ fromResourceCd: 'asc' }, { priority: 'asc' }, { toResourceCd: 'asc' }],
      select: {
        fromResourceCd: true,
        toResourceCd: true,
        priority: true,
        enabled: true,
      },
    }),
    normalizedResourceCds.length > 0
      ? getResourceGroupCandidatesByResourceCds(normalizedResourceCds)
      : Promise.resolve({} as Record<string, string[]>),
  ]);

  const selectedFeatureRows = pickActualHoursRowsByLocationPriority(
    featureRowsWithLocation as FeatureRowWithLocation[],
    actualHoursLocationCandidates
  ).map((row) => ({
    fhincd: row.fhincd,
    resourceCd: row.resourceCd,
    sampleCount: row.sampleCount,
    medianPerPieceMinutes: row.medianPerPieceMinutes,
    p75PerPieceMinutes: row.p75PerPieceMinutes,
  }));

  const sampleCountMap = new Map(
    selectedFeatureRows.map((row) => [
      `${normalizeKeyPart(row.fhincd)}__${normalizeKeyPart(row.resourceCd)}`,
      row.sampleCount,
    ])
  );
  const fetchedFeatureCountByLocation = (featureRowsWithLocation as FeatureRowWithLocation[]).reduce<
    Record<string, number>
  >((acc, row) => {
    const key = row.location.trim() || '__empty__';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return {
    locationCandidates: actualHoursLocationCandidates,
    resolver: createActualHoursFeatureResolver({
      features: selectedFeatureRows,
      resourceCodeMappings: resourceCodeMappings as ResourceCodeMappingRow[],
      resourceGroupCandidatesByResourceCd,
      strategy: params.strategy,
    }),
    selectedFeatureCount: selectedFeatureRows.length,
    fetchedFeatureCountByLocation,
    resourceCodeMappingCount: resourceCodeMappings.length,
    getSampleCountForResolved({ fhincd, matchedResourceCd }) {
      if (!matchedResourceCd) return 0;
      const key = `${normalizeKeyPart(fhincd)}__${normalizeKeyPart(matchedResourceCd)}`;
      return sampleCountMap.get(key) ?? 0;
    },
  };
}
