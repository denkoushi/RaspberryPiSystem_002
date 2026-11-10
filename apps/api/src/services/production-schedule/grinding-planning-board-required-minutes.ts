import type { GrindingPlanningBoardItem, GrindingPlanningBoardResourceMinutesResponse } from '@raspi-system/shared-types';

export function resolveRequiredMinutes(input: {
  originalMinutes: number | null;
  originalKnown: boolean;
  quantity: number | null;
  includeSetup?: boolean;
  effectiveResourceCd: string | null;
  fhincd: string;
}, settings?: GrindingPlanningBoardResourceMinutesResponse): Pick<GrindingPlanningBoardItem,
  'requiredMinutes' | 'requiredMinutesKnown' | 'originalRequiredMinutes' | 'ownRequiredMinutes' | 'requiredMinutesSource'> {
  const resourceCd = input.effectiveResourceCd?.trim();
  const value = settings?.values.find((value) => value.resourceCd === resourceCd && value.fhincd === input.fhincd.trim());
  const ownRequiredMinutes = value && input.quantity != null && Number.isFinite(input.quantity) && input.quantity > 0
    ? value.perUnitMinutes * input.quantity + (input.includeSetup === false ? 0 : value.setupMinutes) : null;
  const originalRequiredMinutes = input.originalKnown ? input.originalMinutes : null;
  const useOwn = ownRequiredMinutes != null && settings?.ownSourceResourceCds.includes(resourceCd ?? '');
  const requiredMinutes = useOwn ? ownRequiredMinutes : originalRequiredMinutes;
  return {
    requiredMinutes, requiredMinutesKnown: requiredMinutes != null,
    originalRequiredMinutes, ownRequiredMinutes, requiredMinutesSource: useOwn ? 'own' : 'original'
  };
}
