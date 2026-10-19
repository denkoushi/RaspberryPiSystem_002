import { describe, expect, it } from 'vitest';

import {
  assemblyBoltConditionPatch,
  assemblyBoltConditionsFromTrainingPrograms,
  buildAssemblyBoltConditionPalette,
  formatAssemblyBoltConditionSpec,
  formatAssemblyBoltConditionTorque,
  tintAssemblyBoltsByCondition
} from './assemblyBoltConditionPalette';
import { createAssemblyBoltAt, emptyAssemblyArea } from './assemblyTemplateDraft';

import type { AssemblyBoltCondition } from './assemblyBoltConditionPalette';
import type { TorqueTrainingProgramApi, TorqueTrainingProgramVersionApi } from '../../api/domains/torque-training';

const m8: AssemblyBoltCondition = {
  nominalDiameter: 'M8',
  boltLengthMm: 25,
  material: 'SCM435',
  strengthClass: '12.9',
  capabilityGroupId: 'group-1',
  nominalTorque: 35.5,
  lowerLimit: 32,
  upperLimit: 39.1,
  unit: 'N·m'
};

function program(patch: Partial<TorqueTrainingProgramVersionApi>, isActive = true): TorqueTrainingProgramApi {
  return {
    id: `program-${patch.nominalDiameter}`,
    code: 'P',
    isActive,
    currentVersion: 2,
    versions: [
      { version: 1, nominalDiameter: 'OLD' } as TorqueTrainingProgramVersionApi,
      {
        version: 2,
        nominalDiameter: 'M8',
        boltLengthMm: '25',
        material: 'SCM435',
        strengthClass: '12.9',
        capabilityGroupId: 'group-1',
        nominalTorque: '35.5',
        lowerLimit: '32',
        upperLimit: '39.1',
        unit: 'N-m',
        ...patch
      } as TorqueTrainingProgramVersionApi
    ]
  };
}

describe('assembly bolt condition palette', () => {
  it('takes the current version of each active training program once', () => {
    const conditions = assemblyBoltConditionsFromTrainingPrograms([
      program({}),
      program({}),
      program({ nominalDiameter: 'M6', nominalTorque: '12.5' }),
      program({ nominalDiameter: 'M10' }, false)
    ]);

    expect(conditions).toEqual([m8, { ...m8, nominalDiameter: 'M6', nominalTorque: 12.5 }]);
  });

  it('lists used conditions by first marker and keeps unused added ones at the end', () => {
    const area = emptyAssemblyArea();
    const first = { ...createAssemblyBoltAt(area, 0.1, 0.1), markerNo: 1, ...assemblyBoltConditionPatch(m8) };
    const blank = { ...createAssemblyBoltAt(area, 0.2, 0.2), markerNo: 2 };
    const third = { ...createAssemblyBoltAt(area, 0.3, 0.3), markerNo: 3, ...assemblyBoltConditionPatch(m8) };
    const m6 = { ...m8, nominalDiameter: 'M6', boltLengthMm: 16 };

    const palette = buildAssemblyBoltConditionPalette([{ ...area, bolts: [third, blank, first] }], [m8, m6]);

    expect(palette.map((entry) => [formatAssemblyBoltConditionSpec(entry.condition), entry.markerNos])).toEqual([
      ['M8×25 SCM435 12.9', [1, 3]],
      ['M6×16 SCM435 12.9', []]
    ]);
    expect(formatAssemblyBoltConditionTorque(m8)).toBe('32 – 35.5 – 39.1 N·m');
  });

  it('tints bolts by their condition and leaves bolts without a condition untouched', () => {
    const area = emptyAssemblyArea();
    const first = { ...createAssemblyBoltAt(area, 0.1, 0.1), markerNo: 1, ...assemblyBoltConditionPatch(m8) };
    const second = { ...createAssemblyBoltAt(area, 0.2, 0.2), markerNo: 2, ...assemblyBoltConditionPatch({ ...m8, nominalDiameter: 'M6' }) };
    const blank = { ...createAssemblyBoltAt(area, 0.3, 0.3), markerNo: 3 };
    const areas = [{ ...area, bolts: [first, second, blank] }];
    const palette = buildAssemblyBoltConditionPalette(areas);
    const canvasBolts = [first, second, blank].map((bolt) => ({ id: bolt.id, markerNo: bolt.markerNo }));

    const tinted = tintAssemblyBoltsByCondition(canvasBolts, areas, palette);

    expect(tinted[0]!.accentClass).toContain('bg-rose-400');
    expect(tinted[1]!.accentClass).toContain('bg-sky-400');
    expect(tinted[2]).toBe(canvasBolts[2]);
  });
});
