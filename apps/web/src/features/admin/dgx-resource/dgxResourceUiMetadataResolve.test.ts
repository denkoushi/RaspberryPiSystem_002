import { describe, expect, it } from 'vitest';

import { DGX_ORCHESTRATION_SCENARIO_META } from './dgxOrchestrationScenarios';
import { DGX_POLICY_PROFILES } from './dgxResourceProfiles';
import {
  resolvePolicyProfile,
  resolvePolicyProfiles,
  resolveScenarioMeta,
  resolveScenarioOrder,
} from './dgxResourceUiMetadataResolve';

import type { DgxResourceUiMetadataApi } from '../../../api/dgx-resource.types';

const apiUiMetadata: DgxResourceUiMetadataApi = {
  scenarios: [
    {
      id: 'business_to_private',
      titleJa: 'API: 私用を始める',
      descriptionJa: 'API: 私用OK へ切替',
      cautionsJa: ['API caution'],
    },
    {
      id: 'private_to_business',
      titleJa: 'API: 業務に戻す',
      descriptionJa: 'API: 業務優先へ',
      cautionsJa: [],
    },
    {
      id: 'business_to_experiment',
      titleJa: 'API: 実験を始める',
      descriptionJa: 'API: 実験優先へ',
      cautionsJa: [],
    },
    {
      id: 'experiment_to_business',
      titleJa: 'API: 実験終了',
      descriptionJa: 'API: 業務復帰',
      cautionsJa: [],
    },
  ],
  policyModes: [
    {
      mode: 'business_first',
      labelJa: 'API: 業務優先',
      titleFullJa: 'API: 業務優先フル',
      descriptionJa: 'API: 業務説明',
      autoArbitrationNotesJa: ['API: 業務調停'],
    },
    {
      mode: 'private_ok',
      labelJa: 'API: 私用OK',
      titleFullJa: 'API: 私用OKフル',
      descriptionJa: 'API: 私用説明',
      autoArbitrationNotesJa: ['API: 私用調停'],
    },
    {
      mode: 'experiment_first',
      labelJa: 'API: 実験優先',
      titleFullJa: 'API: 実験優先フル',
      descriptionJa: 'API: 実験説明',
      autoArbitrationNotesJa: ['API: 実験調停'],
    },
  ],
};

describe('dgxResourceUiMetadataResolve', () => {
  it('falls back to local scenario metadata when overview.uiMetadata is absent', () => {
    const meta = resolveScenarioMeta('business_to_private');
    expect(meta.titleJa).toBe(DGX_ORCHESTRATION_SCENARIO_META.business_to_private.titleJa);
    expect(meta.cautionsJa).toEqual([]);
  });

  it('prefers API uiMetadata for scenarios and policy modes when present', () => {
    const overview = { uiMetadata: apiUiMetadata };

    expect(resolveScenarioOrder(overview).map((id) => resolveScenarioMeta(id, overview).titleJa)).toEqual([
      'API: 私用を始める',
      'API: 業務に戻す',
      'API: 実験を始める',
      'API: 実験終了',
    ]);

    const profiles = resolvePolicyProfiles(overview);
    expect(profiles.map((p) => p.titleShort)).toEqual(['API: 業務優先', 'API: 私用OK', 'API: 実験優先']);
    expect(resolvePolicyProfile('private_ok', overview).description).toBe('API: 私用説明');
    expect(resolvePolicyProfile('business_first', overview).autoArbitrationNotesJa).toEqual(['API: 業務調停']);
  });

  it('falls back to local policy profiles when overview.uiMetadata is absent', () => {
    const profiles = resolvePolicyProfiles();
    expect(profiles[0]?.titleShort).toBe(DGX_POLICY_PROFILES.business_first.titleShort);
    expect(profiles[0]?.autoArbitrationNotesJa).toEqual([]);
  });
});
