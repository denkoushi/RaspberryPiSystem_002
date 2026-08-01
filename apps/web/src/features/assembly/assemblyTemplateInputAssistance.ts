import { normalizeFastenerText } from '@raspi-system/shared-types';

import type { AssemblyDraftBolt } from './assemblyTemplateDraft';
import type { TorqueWrenchCapabilityGroupApi } from '../../api/domains/torque-wrenches';

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
