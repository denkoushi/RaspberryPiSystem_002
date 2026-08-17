import type { TorqueTrainingProgramWritePayload } from '../../../api/client';

/**
 * Values used while editing a torque-training program in the admin UI.
 *
 * Numeric values stay as strings until submit so the form can represent an
 * empty input without coercing it to zero.  Conversion to the API shape is
 * deliberately kept outside the view/controller so it can be tested as a
 * pure function.
 */
export type TorqueTrainingProgramForm = {
  code: string;
  displayName: string;
  nominalDiameter: string;
  boltLengthMm: string;
  material: string;
  strengthClass: string;
  capabilityGroupId: string;
  nominalTorque: string;
  lowerLimit: string;
  upperLimit: string;
  unit: string;
  jigConditionCode: string;
  torqueWrenchProfileIds: string[];
};

export const EMPTY_TORQUE_TRAINING_PROGRAM_FORM: TorqueTrainingProgramForm = {
  code: '',
  displayName: '',
  nominalDiameter: '',
  boltLengthMm: '',
  material: '',
  strengthClass: '',
  capabilityGroupId: '',
  nominalTorque: '',
  lowerLimit: '',
  upperLimit: '',
  unit: 'N-m',
  jigConditionCode: '',
  torqueWrenchProfileIds: []
};

/** Convert the editable form representation into the existing API payload. */
export function torqueTrainingProgramFormToPayload(
  form: TorqueTrainingProgramForm
): TorqueTrainingProgramWritePayload {
  return {
    code: form.code,
    displayName: form.displayName,
    nominalDiameter: form.nominalDiameter,
    boltLengthMm: Number(form.boltLengthMm),
    material: form.material,
    strengthClass: form.strengthClass,
    capabilityGroupId: form.capabilityGroupId,
    nominalTorque: Number(form.nominalTorque),
    lowerLimit: Number(form.lowerLimit),
    upperLimit: Number(form.upperLimit),
    unit: form.unit,
    jigConditionCode: form.jigConditionCode,
    torqueWrenchProfileIds: [...form.torqueWrenchProfileIds]
  };
}

/** Build the revision payload, which intentionally does not include `code`. */
export function torqueTrainingProgramFormToRevisionPayload(
  form: TorqueTrainingProgramForm
): Omit<TorqueTrainingProgramWritePayload, 'code'> {
  const { code, ...revisionPayload } = torqueTrainingProgramFormToPayload(form);
  void code;
  return revisionPayload;
}
