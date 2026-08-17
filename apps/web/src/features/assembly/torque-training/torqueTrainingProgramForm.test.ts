import { describe, expect, it } from 'vitest';

import {
  EMPTY_TORQUE_TRAINING_PROGRAM_FORM,
  torqueTrainingProgramFormToPayload,
  torqueTrainingProgramFormToRevisionPayload
} from './torqueTrainingProgramForm';

describe('torqueTrainingProgramForm', () => {
  it('converts editable numeric fields into the existing write payload', () => {
    const payload = torqueTrainingProgramFormToPayload({
      ...EMPTY_TORQUE_TRAINING_PROGRAM_FORM,
      code: 'M8-001',
      displayName: 'M8 training',
      nominalDiameter: 'M8',
      boltLengthMm: '25',
      material: 'SUS',
      strengthClass: 'A2-70',
      capabilityGroupId: 'group-1',
      nominalTorque: '12.5',
      lowerLimit: '10',
      upperLimit: '15',
      jigConditionCode: 'JIG-A',
      torqueWrenchProfileIds: ['wrench-1', 'wrench-2']
    });

    expect(payload).toEqual({
      code: 'M8-001',
      displayName: 'M8 training',
      nominalDiameter: 'M8',
      boltLengthMm: 25,
      material: 'SUS',
      strengthClass: 'A2-70',
      capabilityGroupId: 'group-1',
      nominalTorque: 12.5,
      lowerLimit: 10,
      upperLimit: 15,
      unit: 'N-m',
      jigConditionCode: 'JIG-A',
      torqueWrenchProfileIds: ['wrench-1', 'wrench-2']
    });
  });

  it('does not share the mutable wrench selection array with the form', () => {
    const form = { ...EMPTY_TORQUE_TRAINING_PROGRAM_FORM, torqueWrenchProfileIds: ['wrench-1'] };
    const payload = torqueTrainingProgramFormToPayload(form);

    expect(payload.torqueWrenchProfileIds).toEqual(['wrench-1']);
    expect(payload.torqueWrenchProfileIds).not.toBe(form.torqueWrenchProfileIds);
  });

  it('omits only code from a revision payload', () => {
    const revisionPayload = torqueTrainingProgramFormToRevisionPayload({
      ...EMPTY_TORQUE_TRAINING_PROGRAM_FORM,
      code: 'M8-001',
      boltLengthMm: '25',
      nominalTorque: '12.5',
      lowerLimit: '10',
      upperLimit: '15'
    });

    expect(revisionPayload).toEqual({
      displayName: '',
      nominalDiameter: '',
      boltLengthMm: 25,
      material: '',
      strengthClass: '',
      capabilityGroupId: '',
      nominalTorque: 12.5,
      lowerLimit: 10,
      upperLimit: 15,
      unit: 'N-m',
      jigConditionCode: '',
      torqueWrenchProfileIds: []
    });
    expect('code' in revisionPayload).toBe(false);
  });
});
