export const GLOBAL_SHARED_LOCATION_KEY = 'shared-global-rank';
export const LOCAL_TEMPORARY_OVERRIDE_TTL_MINUTES = 8 * 60;

export type RankingScope = 'globalShared' | 'locationScoped' | 'localTemporary';

export type RankingScopePolicy = {
  scope: RankingScope;
  rankLocationKey: string;
  targetLocation: string;
  actorLocation: string;
};

export function resolveRankingScopePolicy(params: {
  requestedScope?: string | null;
  actorLocation: string;
  targetLocation: string;
}): RankingScopePolicy {
  const normalizedScope = (params.requestedScope ?? '').trim();
  if (normalizedScope === 'locationScoped') {
    return {
      scope: 'locationScoped',
      rankLocationKey: params.targetLocation,
      targetLocation: params.targetLocation,
      actorLocation: params.actorLocation
    };
  }
  if (normalizedScope === 'localTemporary') {
    return {
      scope: 'localTemporary',
      rankLocationKey: GLOBAL_SHARED_LOCATION_KEY,
      targetLocation: params.targetLocation,
      actorLocation: params.actorLocation
    };
  }
  return {
    scope: 'globalShared',
    rankLocationKey: GLOBAL_SHARED_LOCATION_KEY,
    targetLocation: params.targetLocation,
    actorLocation: params.actorLocation
  };
}
