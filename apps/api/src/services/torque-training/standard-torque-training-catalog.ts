/**
 * The versioned catalogue used by the torque-training registration command.
 *
 * This module deliberately contains no database or HTTP concerns.  Keeping
 * the 14 definitions here makes the values reusable by the registration
 * command and by unit tests without having to boot Prisma.
 */

export const STANDARD_TORQUE_TRAINING_UNIT = 'N·m' as const;

export type StandardTorqueTrainingMaterialKey = 'CS' | 'SUS';

export type StandardTorqueTrainingMenu = {
  readonly code: string;
  readonly capabilityGroupName: string;
  readonly displayName: string;
  readonly nominalDiameter: string;
  readonly boltLengthMm: number;
  readonly material: string;
  readonly strengthClass: string;
  readonly lowerLimit: string;
  readonly nominalTorque: string;
  readonly upperLimit: string;
  readonly unit: typeof STANDARD_TORQUE_TRAINING_UNIT;
  readonly jigConditionCode: string;
  readonly materialKey: StandardTorqueTrainingMaterialKey;
};

type StandardTorqueRow = {
  readonly nominalDiameter: string;
  readonly codeDiameter: string;
  readonly boltLengthMm: number;
  readonly carbonSteel: readonly [string, string, string];
  readonly stainless: readonly [string, string, string];
};

const STANDARD_TORQUE_ROWS: readonly StandardTorqueRow[] = [
  { nominalDiameter: 'M2', codeDiameter: '020', boltLengthMm: 4, carbonSteel: ['0.43', '0.50', '0.58'], stainless: ['0.19', '0.22', '0.25'] },
  { nominalDiameter: 'M2.5', codeDiameter: '025', boltLengthMm: 5, carbonSteel: ['0.75', '0.90', '1.05'], stainless: ['0.35', '0.40', '0.45'] },
  { nominalDiameter: 'M3', codeDiameter: '030', boltLengthMm: 6, carbonSteel: ['1.30', '1.50', '1.70'], stainless: ['0.60', '0.70', '0.80'] },
  { nominalDiameter: 'M4', codeDiameter: '040', boltLengthMm: 8, carbonSteel: ['3.00', '3.60', '4.10'], stainless: ['1.35', '1.60', '1.85'] },
  { nominalDiameter: 'M5', codeDiameter: '050', boltLengthMm: 10, carbonSteel: ['6.00', '7.00', '8.00'], stainless: ['2.70', '3.20', '3.70'] },
  { nominalDiameter: 'M6', codeDiameter: '060', boltLengthMm: 12, carbonSteel: ['10.00', '12.00', '14.00'], stainless: ['4.70', '5.50', '6.30'] },
  { nominalDiameter: 'M8', codeDiameter: '080', boltLengthMm: 16, carbonSteel: ['25.00', '29.00', '33.00'], stainless: ['11.00', '13.00', '15.00'] }
] as const;

const MATERIALS: readonly {
  readonly key: StandardTorqueTrainingMaterialKey;
  readonly suffix: string;
  readonly material: string;
  readonly strengthClass: string;
  readonly jigConditionCode: string;
}[] = [
  {
    key: 'CS',
    suffix: '炭素鋼',
    material: '炭素鋼',
    strengthClass: '12.9',
    jigConditionCode: 'BOLT-2D-CS129-BLACK-OXIDE-DRY-ROOM'
  },
  {
    key: 'SUS',
    suffix: 'ステンレス',
    material: 'SUS304',
    strengthClass: 'A2-70相当',
    jigConditionCode: 'BOLT-2D-SUS304-A2-70'
  }
] as const;

function createMenu(
  row: StandardTorqueRow,
  material: (typeof MATERIALS)[number],
  torque: readonly [string, string, string]
): StandardTorqueTrainingMenu {
  const code = `TT-${row.codeDiameter}-${material.key}-2D`;
  return {
    code,
    capabilityGroupName: code,
    displayName: `${row.nominalDiameter} 首下${row.boltLengthMm}mm ${material.suffix}（${material.strengthClass}） ${material.jigConditionCode}`,
    nominalDiameter: row.nominalDiameter,
    boltLengthMm: row.boltLengthMm,
    material: material.material,
    strengthClass: material.strengthClass,
    lowerLimit: torque[0],
    nominalTorque: torque[1],
    upperLimit: torque[2],
    unit: STANDARD_TORQUE_TRAINING_UNIT,
    jigConditionCode: material.jigConditionCode,
    materialKey: material.key
  };
}

export const STANDARD_TORQUE_TRAINING_CATALOG: readonly StandardTorqueTrainingMenu[] = STANDARD_TORQUE_ROWS.flatMap(
  (row) => [
    createMenu(row, MATERIALS[0], row.carbonSteel),
    createMenu(row, MATERIALS[1], row.stainless)
  ]
);

export const STANDARD_TORQUE_TRAINING_CODES = STANDARD_TORQUE_TRAINING_CATALOG.map((menu) => menu.code);

export const STANDARD_TORQUE_TRAINING_M5_CODES = STANDARD_TORQUE_TRAINING_CATALOG
  .filter((menu) => menu.nominalDiameter === 'M5')
  .map((menu) => menu.code);

export function findStandardTorqueTrainingMenu(code: string): StandardTorqueTrainingMenu | undefined {
  return STANDARD_TORQUE_TRAINING_CATALOG.find((menu) => menu.code === code);
}
