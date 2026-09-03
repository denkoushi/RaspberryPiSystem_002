import { normalizeFastenerText } from '@raspi-system/shared-types';

import type { AssemblyDraftBolt } from './assemblyTemplateDraft';
import type {
  TorqueWrenchCapabilityGroupApi,
  TorqueWrenchProfileApi,
  TorqueWrenchSettingApi
} from '../../api/domains/torque-wrenches';

const normalizeNamePart = (value: string): string =>
  value.trim().replace(/\s+/g, ' ');

export function buildAssemblyTemplateSuggestedName(
  modelCode: string,
  procedurePattern: string
): string {
  const model = normalizeNamePart(modelCode);
  const pattern = normalizeNamePart(procedurePattern);
  return model && pattern ? `${model} ${pattern} 組立` : '';
}

export type AssemblyBoltCapabilitySnapshot = Pick<
  AssemblyDraftBolt,
  | 'capabilityGroupId'
  | 'nominalDiameter'
  | 'boltLengthMm'
  | 'material'
  | 'strengthClass'
>;

export type AssemblyBoltStoredCondition = {
  nominalDiameter?: string | null;
  boltLengthMm?: number | null;
  material?: string | null;
  strengthClass?: string | null;
};

export function capabilityGroupToAssemblyBoltCondition(
  group: TorqueWrenchCapabilityGroupApi
): AssemblyBoltCapabilitySnapshot {
  const length = Number(group.boltLengthMm);
  return {
    capabilityGroupId: group.id,
    nominalDiameter: group.nominalDiameter,
    boltLengthMm: Number.isFinite(length) ? length : null,
    material: group.material,
    strengthClass: group.strengthClass
  };
}

export function doesCapabilityGroupMatchAssemblyBoltCondition(
  group: TorqueWrenchCapabilityGroupApi,
  condition: AssemblyBoltStoredCondition
): boolean {
  return (
    group.isActive &&
    normalizeFastenerText(group.nominalDiameter) ===
      normalizeFastenerText(condition.nominalDiameter ?? '') &&
    Number(group.boltLengthMm) === condition.boltLengthMm &&
    normalizeFastenerText(group.material) ===
      normalizeFastenerText(condition.material ?? '') &&
    normalizeFastenerText(group.strengthClass) ===
      normalizeFastenerText(condition.strengthClass ?? '')
  );
}

export type AssemblyTorqueWrenchProfileCatalogStatus = 'loading' | 'ready' | 'error';

export type AssemblyTorqueWrenchSettingCandidate = {
  key: string;
  setting: Pick<
    TorqueWrenchSettingApi,
    'lowerLimit' | 'nominalTorque' | 'upperLimit' | 'unit'
  >;
  profiles: TorqueWrenchProfileApi[];
};

export type AssemblyTorqueWrenchPresetCandidates = {
  candidates: AssemblyTorqueWrenchSettingCandidate[];
  unregisteredProfiles: TorqueWrenchProfileApi[];
  matchingProfileCount: number;
};

function normalizeTorqueValue(value: string): string {
  const trimmed = value.trim();
  const sign = trimmed.startsWith('-') ? '-' : '';
  const unsigned = sign ? trimmed.slice(1) : trimmed;
  const [integerPart = '', fractionPart] = unsigned.split('.');
  if (!/^\d*$/.test(integerPart) || (fractionPart != null && !/^\d*$/.test(fractionPart))) {
    return trimmed;
  }
  const integer = integerPart.replace(/^0+(?=\d)/, '') || '0';
  const fraction = fractionPart?.replace(/0+$/, '') ?? '';
  if (!fraction) return integer === '0' ? '0' : `${sign}${integer}`;
  if (integer === '0' && /^0+$/.test(fraction)) return '0';
  return `${sign}${integer}.${fraction}`;
}

function settingCandidateKey(setting: Pick<
  TorqueWrenchSettingApi,
  'lowerLimit' | 'nominalTorque' | 'upperLimit' | 'unit'
>): string {
  return [
    setting.unit,
    normalizeTorqueValue(setting.lowerLimit),
    normalizeTorqueValue(setting.nominalTorque),
    normalizeTorqueValue(setting.upperLimit)
  ].join('|');
}

/**
 * Resolve the latest registered setting candidates for a selected group.
 *
 * Capability groups link model IDs, while settings belong to serial-numbered
 * profiles. A profile with no latest registered setting (including the
 * BOLT_CONDITION_ONLY mode) is deliberately returned separately so callers
 * can prevent an apparently safe automatic fill when an unregistered wrench
 * is also in the group.
 */
export function buildAssemblyTorqueWrenchPresetCandidates(
  group: TorqueWrenchCapabilityGroupApi | null | undefined,
  profiles: readonly TorqueWrenchProfileApi[]
): AssemblyTorqueWrenchPresetCandidates {
  if (!group || !group.isActive) {
    return { candidates: [], unregisteredProfiles: [], matchingProfileCount: 0 };
  }

  const activeModelIds = new Set(
    group.models
      .filter(({ model }) => model.isActive)
      .map(({ modelId }) => modelId)
  );
  const matchingProfiles = profiles.filter(
    (profile) =>
      profile.measuringInstrument.status !== 'RETIRED' &&
      profile.model.isActive &&
      activeModelIds.has(profile.modelId)
  );
  const unregisteredProfiles: TorqueWrenchProfileApi[] = [];
  const candidatesByKey = new Map<string, AssemblyTorqueWrenchSettingCandidate>();

  for (const profile of matchingProfiles) {
    const latest = profile.settingHistories[0];
    if (profile.model.settingVerificationMode === 'BOLT_CONDITION_ONLY' || !latest) {
      unregisteredProfiles.push(profile);
      continue;
    }
    const setting = {
      lowerLimit: latest.lowerLimit,
      nominalTorque: latest.nominalTorque,
      upperLimit: latest.upperLimit,
      unit: latest.unit
    };
    const key = settingCandidateKey(setting);
    const candidate = candidatesByKey.get(key);
    if (candidate) {
      candidate.profiles.push(profile);
    } else {
      candidatesByKey.set(key, { key, setting, profiles: [profile] });
    }
  }

  return {
    candidates: [...candidatesByKey.values()],
    unregisteredProfiles,
    matchingProfileCount: matchingProfiles.length
  };
}
