import { describe, expect, it } from 'vitest';

import {
  EMPTY_TORQUE_TRAINING_PROGRAM_FORM,
  torqueTrainingProgramFormToPayload,
  torqueTrainingProgramFormToRevisionPayload,
  torqueTrainingProgramVersionToForm
} from './torqueTrainingProgramForm';

describe('torqueTrainingProgramForm', () => {
  it('maps a persisted version into a revision form without sharing wrench state', () => {
    const version = {
      id: 'version-2',
      version: 2,
      displayName: 'M8 training v2',
      nominalDiameter: 'M8',
      boltLengthMm: '30',
      material: 'SUS304',
      strengthClass: 'A2-70',
      capabilityGroupId: 'group-2',
      nominalTorque: '12.5',
      lowerLimit: '10',
      upperLimit: '15',
      unit: 'N-m',
      jigConditionCode: 'JIG-B',
      conditionFingerprint: 'fingerprint-v2',
      torqueWrenchProfiles: [
        { id: 'wrench-2', serialNumber: 'TW-002' },
        { id: 'wrench-3', serialNumber: 'TW-003' }
      ],
      setupState: 'READY',
      setupStateReason: null
    };

    const form = torqueTrainingProgramVersionToForm('M8-001', version);

    expect(form).toEqual({
      code: 'M8-001',
      displayName: 'M8 training v2',
      nominalDiameter: 'M8',
      boltLengthMm: '30',
      material: 'SUS304',
      strengthClass: 'A2-70',
      capabilityGroupId: 'group-2',
      nominalTorque: '12.5',
      lowerLimit: '10',
      upperLimit: '15',
      unit: 'N-m',
      jigConditionCode: 'JIG-B',
      torqueWrenchProfileIds: ['wrench-2', 'wrench-3']
    });
    expect(form.torqueWrenchProfileIds).not.toBe(version.torqueWrenchProfiles);
  });

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
