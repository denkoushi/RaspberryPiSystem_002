import type { AssemblyDraftArea, AssemblyDraftBolt } from './assemblyTemplateDraft';
import type { TorqueTrainingProgramApi } from '../../api/domains/torque-training';

/** 丸数字へ一括で当てる締付条件（位置や番号を含まない）。 */
export type AssemblyBoltCondition = Pick<
  AssemblyDraftBolt,
  | 'nominalDiameter'
  | 'boltLengthMm'
  | 'material'
  | 'strengthClass'
  | 'capabilityGroupId'
  | 'nominalTorque'
  | 'lowerLimit'
  | 'upperLimit'
  | 'unit'
>;

export type AssemblyBoltConditionPaletteEntry = {
  key: string;
  condition: AssemblyBoltCondition;
  /** この条件を使っている丸数字（昇順）。 */
  markerNos: number[];
};

function normalizeUnit(unit: string): string {
  const trimmed = unit.trim();
  return trimmed === 'N-m' || trimmed === 'Nm' ? 'N·m' : trimmed;
}

function finiteOrNull(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function assemblyBoltConditionKey(condition: AssemblyBoltCondition): string {
  return [
    condition.nominalDiameter?.trim() ?? '',
    condition.boltLengthMm ?? '',
    condition.material?.trim() ?? '',
    condition.strengthClass?.trim() ?? '',
    condition.capabilityGroupId ?? '',
    condition.lowerLimit ?? '',
    condition.nominalTorque ?? '',
    condition.upperLimit ?? '',
    normalizeUnit(condition.unit)
  ].join('|');
}

/** 何も入力されていない丸数字は条件として数えない。 */
export function assemblyBoltConditionFromBolt(bolt: AssemblyDraftBolt): AssemblyBoltCondition | null {
  if (!bolt.nominalDiameter?.trim() && bolt.nominalTorque == null) return null;
  return {
    nominalDiameter: bolt.nominalDiameter,
    boltLengthMm: bolt.boltLengthMm,
    material: bolt.material,
    strengthClass: bolt.strengthClass,
    capabilityGroupId: bolt.capabilityGroupId,
    nominalTorque: bolt.nominalTorque,
    lowerLimit: bolt.lowerLimit,
    upperLimit: bolt.upperLimit,
    unit: normalizeUnit(bolt.unit)
  };
}

/** 有効な訓練メニューの現行版を、重複のない締付条件へ変換する。 */
export function assemblyBoltConditionsFromTrainingPrograms(
  programs: readonly TorqueTrainingProgramApi[]
): AssemblyBoltCondition[] {
  const byKey = new Map<string, AssemblyBoltCondition>();
  for (const program of programs) {
    if (!program.isActive) continue;
    const version = program.versions.find((candidate) => candidate.version === program.currentVersion);
    if (!version) continue;
    const condition: AssemblyBoltCondition = {
      nominalDiameter: version.nominalDiameter,
      boltLengthMm: finiteOrNull(version.boltLengthMm),
      material: version.material,
      strengthClass: version.strengthClass,
      capabilityGroupId: version.capabilityGroupId,
      nominalTorque: finiteOrNull(version.nominalTorque),
      lowerLimit: finiteOrNull(version.lowerLimit),
      upperLimit: finiteOrNull(version.upperLimit),
      unit: normalizeUnit(version.unit)
    };
    const key = assemblyBoltConditionKey(condition);
    if (!byKey.has(key)) byKey.set(key, condition);
  }
  return [...byKey.values()];
}

/**
 * テンプレート内で使われている条件を丸数字の若い順に並べ、
 * まだ使われていない追加済み条件を後ろへ足す。
 */
export function buildAssemblyBoltConditionPalette(
  areas: readonly AssemblyDraftArea[],
  pendingConditions: readonly AssemblyBoltCondition[] = []
): AssemblyBoltConditionPaletteEntry[] {
  const entries = new Map<string, AssemblyBoltConditionPaletteEntry>();
  const bolts = areas.flatMap((area) => area.bolts).sort((a, b) => a.markerNo - b.markerNo);
  for (const bolt of bolts) {
    const condition = assemblyBoltConditionFromBolt(bolt);
    if (!condition) continue;
    const key = assemblyBoltConditionKey(condition);
    const entry = entries.get(key) ?? { key, condition, markerNos: [] };
    entry.markerNos.push(bolt.markerNo);
    entries.set(key, entry);
  }
  for (const condition of pendingConditions) {
    const key = assemblyBoltConditionKey(condition);
    if (!entries.has(key)) entries.set(key, { key, condition, markerNos: [] });
  }
  return [...entries.values()];
}

/** 条件を当てると、個別指定していたボルト仕様名は自動生成へ戻る。 */
export function assemblyBoltConditionPatch(condition: AssemblyBoltCondition): Partial<AssemblyDraftBolt> {
  return { ...condition, boltSpecMode: 'auto', boltSpecCustom: '' };
}

export function formatAssemblyBoltConditionSpec(condition: AssemblyBoltCondition): string {
  const size = [condition.nominalDiameter?.trim(), condition.boltLengthMm != null ? String(condition.boltLengthMm) : '']
    .filter(Boolean)
    .join('×');
  return [size || '径未設定', condition.material?.trim(), condition.strengthClass?.trim()].filter(Boolean).join(' ');
}

export function formatAssemblyBoltConditionTorque(condition: AssemblyBoltCondition): string {
  const value = (raw: number | null) => (raw == null ? '-' : String(raw));
  return `${value(condition.lowerLimit)} – ${value(condition.nominalTorque)} – ${value(condition.upperLimit)} ${condition.unit}`.trim();
}
