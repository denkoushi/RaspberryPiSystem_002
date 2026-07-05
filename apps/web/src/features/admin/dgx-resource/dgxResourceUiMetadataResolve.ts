import {
  DGX_ORCHESTRATION_SCENARIO_META,
  DGX_ORCHESTRATION_SCENARIO_ORDER,
  type DgxOrchestrationScenarioMeta,
} from './dgxOrchestrationScenarios';
import { DGX_POLICY_PROFILES, orderProfilesForUi, type DgxPolicyProfileUi } from './dgxResourceProfiles';

import type {
  DgxOrchestrationScenarioIdApi,
  DgxPolicyModeApi,
  DgxResourceOverview,
  DgxResourceUiMetadataApi,
} from '../../../api/dgx-resource.types';

export type ResolvedScenarioMeta = DgxOrchestrationScenarioMeta & {
  cautionsJa: string[];
};

export type ResolvedPolicyProfileUi = DgxPolicyProfileUi & {
  autoArbitrationNotesJa: string[];
};

function hasUiMetadata(overview?: Pick<DgxResourceOverview, 'uiMetadata'> | null): overview is {
  uiMetadata: DgxResourceUiMetadataApi;
} {
  return overview?.uiMetadata != null && Array.isArray(overview.uiMetadata.scenarios);
}

export function resolveScenarioOrder(
  overview?: Pick<DgxResourceOverview, 'uiMetadata'> | null
): readonly DgxOrchestrationScenarioIdApi[] {
  if (hasUiMetadata(overview) && overview.uiMetadata.scenarios.length > 0) {
    return overview.uiMetadata.scenarios.map((s) => s.id);
  }
  return DGX_ORCHESTRATION_SCENARIO_ORDER;
}

export function resolveScenarioMeta(
  scenarioId: DgxOrchestrationScenarioIdApi,
  overview?: Pick<DgxResourceOverview, 'uiMetadata'> | null
): ResolvedScenarioMeta {
  const fromApi = hasUiMetadata(overview)
    ? overview.uiMetadata.scenarios.find((s) => s.id === scenarioId)
    : undefined;
  if (fromApi) {
    return {
      id: fromApi.id,
      titleJa: fromApi.titleJa,
      descriptionJa: fromApi.descriptionJa,
      cautionsJa: fromApi.cautionsJa ?? [],
    };
  }
  const local = DGX_ORCHESTRATION_SCENARIO_META[scenarioId];
  return { ...local, cautionsJa: [] };
}

export function resolvePolicyProfiles(
  overview?: Pick<DgxResourceOverview, 'uiMetadata'> | null
): ResolvedPolicyProfileUi[] {
  if (hasUiMetadata(overview) && overview.uiMetadata.policyModes.length > 0) {
    const order: DgxPolicyModeApi[] = ['business_first', 'private_ok', 'experiment_first'];
    return order.map((mode) => {
      const fromApi = overview.uiMetadata.policyModes.find((p) => p.mode === mode);
      if (!fromApi) {
        return { ...DGX_POLICY_PROFILES[mode], autoArbitrationNotesJa: [] };
      }
      return {
        mode: fromApi.mode,
        titleShort: fromApi.labelJa,
        titleFull: fromApi.titleFullJa,
        description: fromApi.descriptionJa,
        autoArbitrationNotesJa: fromApi.autoArbitrationNotesJa ?? [],
      };
    });
  }
  return orderProfilesForUi().map((p) => ({ ...p, autoArbitrationNotesJa: [] }));
}

export function resolvePolicyProfile(
  mode: DgxPolicyModeApi,
  overview?: Pick<DgxResourceOverview, 'uiMetadata'> | null
): ResolvedPolicyProfileUi {
  return resolvePolicyProfiles(overview).find((p) => p.mode === mode) ?? {
    ...DGX_POLICY_PROFILES[mode],
    autoArbitrationNotesJa: [],
  };
}
