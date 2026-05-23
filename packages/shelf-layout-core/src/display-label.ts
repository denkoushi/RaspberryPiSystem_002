import { nearestMachineDirection, type MachineAnchor } from './direction.js';
import { indexToRc } from './zone-catalog.js';

export type DisplayLabelInput = {
  cellIndices: number[];
  gridSize: number;
  machines: MachineAnchor[];
  existingLabelsInZone: string[];
};

/**
 * 表示名 = `{加工機名}{方位}`。加工機 0 台時 `置場-{方位}`。
 * 同区画重複時 `-2`, `-3` … サフィックス。
 */
export function buildAutoDisplayLabel(input: DisplayLabelInput): string {
  const nearest = nearestMachineDirection(input.cellIndices, input.gridSize, input.machines, indexToRc);
  const direction = nearest?.direction ?? '中央';
  const base =
    nearest == null ? `置場-${direction}` : `${nearest.resourceName}${direction}`;
  return dedupeDisplayLabel(base, input.existingLabelsInZone);
}

export function dedupeDisplayLabel(base: string, existingLabelsInZone: string[]): string {
  if (!existingLabelsInZone.includes(base)) {
    return base;
  }
  let n = 2;
  while (existingLabelsInZone.includes(`${base}-${n}`)) {
    n += 1;
  }
  return `${base}-${n}`;
}
