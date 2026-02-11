import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { fetchSeibanProgressRows } from './seiban-progress.service.js';

const SHARED_SEARCH_STATE_LOCATION = 'shared';
const SEARCH_STATE_MISSING_ETAG = 'missing';

const normalizeSearchHistory = (history: string[]): string[] => {
  const unique = new Set<string>();
  const next: string[] = [];
  history
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .forEach((item) => {
      if (unique.has(item)) return;
      unique.add(item);
      next.push(item);
    });
  return next.slice(0, 20);
};

const buildSearchStateEtag = (value: string): string => `W/"${value}"`;

const normalizeIfMatchValue = (raw: string): string => {
  let value = raw.trim();
  if (value.startsWith('W/')) {
    value = value.slice(2).trim();
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  }
  return value;
};

const parseIfMatch = (header: unknown): string | null => {
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const first = raw.split(',')[0]?.trim();
  if (!first) return null;
  return normalizeIfMatchValue(first);
};

const extractSearchHistory = (state: Prisma.JsonValue | null | undefined): string[] => {
  return normalizeSearchHistory(((state as { history?: string[] } | null)?.history ?? []) as string[]);
};

export async function getProductionScheduleSearchState(locationKey: string): Promise<{
  state: { history: string[] };
  updatedAt: Date | null;
  etag: string;
}> {
  const sharedState = await prisma.kioskProductionScheduleSearchState.findUnique({
    where: {
      csvDashboardId_location: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: SHARED_SEARCH_STATE_LOCATION
      }
    }
  });
  if (sharedState) {
    const history = extractSearchHistory(sharedState.state);
    const etagValue = sharedState.updatedAt?.toISOString() ?? SEARCH_STATE_MISSING_ETAG;
    return {
      state: { history },
      updatedAt: sharedState.updatedAt ?? null,
      etag: buildSearchStateEtag(etagValue)
    };
  }

  const fallbackState = await prisma.kioskProductionScheduleSearchState.findUnique({
    where: {
      csvDashboardId_location: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: locationKey
      }
    }
  });
  const fallbackHistory = extractSearchHistory(fallbackState?.state ?? null);
  const fallbackEtagValue = fallbackState?.updatedAt?.toISOString() ?? SEARCH_STATE_MISSING_ETAG;
  return {
    state: { history: fallbackHistory },
    updatedAt: fallbackState?.updatedAt ?? null,
    etag: buildSearchStateEtag(fallbackEtagValue)
  };
}

export async function getProductionScheduleHistoryProgress(locationKey: string): Promise<{
  history: string[];
  progressBySeiban: Record<string, { total: number; completed: number; status: 'complete' | 'incomplete' }>;
  updatedAt: Date | null;
}> {
  const sharedState = await prisma.kioskProductionScheduleSearchState.findUnique({
    where: {
      csvDashboardId_location: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: SHARED_SEARCH_STATE_LOCATION
      }
    }
  });
  const fallbackState = sharedState
    ? null
    : await prisma.kioskProductionScheduleSearchState.findUnique({
        where: {
          csvDashboardId_location: {
            csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
            location: locationKey
          }
        }
      });
  const effectiveState = sharedState ?? fallbackState;
  const history = extractSearchHistory(effectiveState?.state ?? null);

  const progressRows = await fetchSeibanProgressRows(history);
  const progressMap = new Map(progressRows.map((row) => [row.fseiban, row]));
  const progressBySeiban = Object.fromEntries(
    history.map((fseiban) => {
      const row = progressMap.get(fseiban);
      const total = row?.total ?? 0;
      const completed = row?.completed ?? 0;
      const status: 'complete' | 'incomplete' = total > 0 && completed === total ? 'complete' : 'incomplete';
      return [fseiban, { total, completed, status }];
    })
  );

  return { history, progressBySeiban, updatedAt: effectiveState?.updatedAt ?? null };
}

export async function getProductionScheduleSearchHistory(locationKey: string): Promise<{
  history: string[];
  updatedAt: Date | null;
}> {
  const stored = await prisma.kioskProductionScheduleSearchState.findUnique({
    where: {
      csvDashboardId_location: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: locationKey
      }
    }
  });
  const history = (stored?.state as { history?: string[] } | null)?.history ?? [];
  return { history, updatedAt: stored?.updatedAt ?? null };
}

export async function updateProductionScheduleSearchState(params: {
  locationKey: string;
  ifMatchHeader: unknown;
  incomingHistory: string[];
}): Promise<{ state: { history: string[] }; updatedAt: Date | null; etag: string }> {
  const { locationKey, ifMatchHeader, incomingHistory } = params;
  const ifMatch = parseIfMatch(ifMatchHeader);
  if (!ifMatch) {
    throw new ApiError(
      428,
      'If-Matchヘッダーが必要です。再読込してから再実行してください。',
      undefined,
      'SEARCH_STATE_PRECONDITION_REQUIRED'
    );
  }

  const mergedHistory = normalizeSearchHistory(incomingHistory);

  const sharedState = await prisma.kioskProductionScheduleSearchState.findUnique({
    where: {
      csvDashboardId_location: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: SHARED_SEARCH_STATE_LOCATION
      }
    }
  });

  const buildConflictError = (latest: typeof sharedState | null) => {
    const latestHistory = extractSearchHistory(latest?.state ?? null);
    const latestUpdatedAt = latest?.updatedAt ?? null;
    const etagValue = latestUpdatedAt?.toISOString() ?? SEARCH_STATE_MISSING_ETAG;
    return new ApiError(
      409,
      '検索登録製番が他の端末で更新されています。再読込してやり直してください。',
      {
        state: { history: latestHistory },
        updatedAt: latestUpdatedAt,
        etag: buildSearchStateEtag(etagValue)
      },
      'SEARCH_STATE_CONFLICT'
    );
  };

  if (!sharedState) {
    const fallbackState = await prisma.kioskProductionScheduleSearchState.findUnique({
      where: {
        csvDashboardId_location: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          location: locationKey
        }
      }
    });
    const fallbackEtag = fallbackState?.updatedAt?.toISOString() ?? SEARCH_STATE_MISSING_ETAG;
    if (ifMatch !== fallbackEtag) {
      throw buildConflictError(fallbackState);
    }
    try {
      const created = await prisma.kioskProductionScheduleSearchState.create({
        data: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          location: SHARED_SEARCH_STATE_LOCATION,
          state: { history: mergedHistory } as Prisma.InputJsonValue
        }
      });
      const createdEtag = created.updatedAt?.toISOString() ?? SEARCH_STATE_MISSING_ETAG;
      return { state: { history: mergedHistory }, updatedAt: created.updatedAt, etag: buildSearchStateEtag(createdEtag) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const latest = await prisma.kioskProductionScheduleSearchState.findUnique({
          where: {
            csvDashboardId_location: {
              csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
              location: SHARED_SEARCH_STATE_LOCATION
            }
          }
        });
        throw buildConflictError(latest);
      }
      throw error;
    }
  }

  const sharedEtag = sharedState.updatedAt?.toISOString() ?? SEARCH_STATE_MISSING_ETAG;
  if (ifMatch !== sharedEtag) {
    throw buildConflictError(sharedState);
  }

  const updateResult = await prisma.kioskProductionScheduleSearchState.updateMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      location: SHARED_SEARCH_STATE_LOCATION,
      updatedAt: sharedState.updatedAt
    },
    data: {
      state: { history: mergedHistory } as Prisma.InputJsonValue
    }
  });
  if (updateResult.count === 0) {
    const latest = await prisma.kioskProductionScheduleSearchState.findUnique({
      where: {
        csvDashboardId_location: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          location: SHARED_SEARCH_STATE_LOCATION
        }
      }
    });
    throw buildConflictError(latest);
  }

  const updated = await prisma.kioskProductionScheduleSearchState.findUnique({
    where: {
      csvDashboardId_location: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: SHARED_SEARCH_STATE_LOCATION
      }
    }
  });
  const updatedEtag = updated?.updatedAt?.toISOString() ?? SEARCH_STATE_MISSING_ETAG;
  return {
    state: { history: mergedHistory },
    updatedAt: updated?.updatedAt ?? null,
    etag: buildSearchStateEtag(updatedEtag)
  };
}

export async function updateProductionScheduleSearchHistory(params: {
  locationKey: string;
  history: string[];
}): Promise<{ history: string[]; updatedAt: Date | null }> {
  const { locationKey, history } = params;
  const normalizedHistory = normalizeSearchHistory(history);

  const state = await prisma.kioskProductionScheduleSearchState.upsert({
    where: {
      csvDashboardId_location: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: locationKey
      }
    },
    update: {
      state: { history: normalizedHistory } as Prisma.InputJsonValue
    },
    create: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      location: locationKey,
      state: { history: normalizedHistory } as Prisma.InputJsonValue
    }
  });
  return { history: normalizedHistory, updatedAt: state.updatedAt };
}
