import { describe, expect, it } from 'vitest';

import {
  STANDARD_TORQUE_TRAINING_CATALOG,
  STANDARD_TORQUE_TRAINING_M5_CODES,
  findStandardTorqueTrainingMenu
} from './standard-torque-training-catalog.js';

describe('standard torque training catalogue', () => {
  it('contains the seven diameters for carbon steel and stainless steel', () => {
    expect(STANDARD_TORQUE_TRAINING_CATALOG).toHaveLength(14);
    expect(STANDARD_TORQUE_TRAINING_CATALOG.map((menu) => menu.code)).toEqual([
      'TT-020-CS-2D',
      'TT-020-SUS-2D',
      'TT-025-CS-2D',
      'TT-025-SUS-2D',
      'TT-030-CS-2D',
      'TT-030-SUS-2D',
      'TT-040-CS-2D',
      'TT-040-SUS-2D',
      'TT-050-CS-2D',
      'TT-050-SUS-2D',
      'TT-060-CS-2D',
      'TT-060-SUS-2D',
      'TT-080-CS-2D',
      'TT-080-SUS-2D'
    ]);
    expect(STANDARD_TORQUE_TRAINING_M5_CODES).toEqual(['TT-050-CS-2D', 'TT-050-SUS-2D']);
  });

  it.each([
    ['TT-020-CS-2D', 'M2', 4, ['0.43', '0.50', '0.58'], '炭素鋼', '12.9', 'BOLT-2D-CS129-BLACK-OXIDE-DRY-ROOM'],
    ['TT-025-CS-2D', 'M2.5', 5, ['0.75', '0.90', '1.05'], '炭素鋼', '12.9', 'BOLT-2D-CS129-BLACK-OXIDE-DRY-ROOM'],
    ['TT-030-CS-2D', 'M3', 6, ['1.30', '1.50', '1.70'], '炭素鋼', '12.9', 'BOLT-2D-CS129-BLACK-OXIDE-DRY-ROOM'],
    ['TT-040-CS-2D', 'M4', 8, ['3.00', '3.60', '4.10'], '炭素鋼', '12.9', 'BOLT-2D-CS129-BLACK-OXIDE-DRY-ROOM'],
    ['TT-050-CS-2D', 'M5', 10, ['6.00', '7.00', '8.00'], '炭素鋼', '12.9', 'BOLT-2D-CS129-BLACK-OXIDE-DRY-ROOM'],
    ['TT-060-CS-2D', 'M6', 12, ['10.00', '12.00', '14.00'], '炭素鋼', '12.9', 'BOLT-2D-CS129-BLACK-OXIDE-DRY-ROOM'],
    ['TT-080-CS-2D', 'M8', 16, ['25.00', '29.00', '33.00'], '炭素鋼', '12.9', 'BOLT-2D-CS129-BLACK-OXIDE-DRY-ROOM'],
    ['TT-020-SUS-2D', 'M2', 4, ['0.19', '0.22', '0.25'], 'SUS304', 'A2-70相当', 'BOLT-2D-SUS304-A2-70'],
    ['TT-025-SUS-2D', 'M2.5', 5, ['0.35', '0.40', '0.45'], 'SUS304', 'A2-70相当', 'BOLT-2D-SUS304-A2-70'],
    ['TT-030-SUS-2D', 'M3', 6, ['0.60', '0.70', '0.80'], 'SUS304', 'A2-70相当', 'BOLT-2D-SUS304-A2-70'],
    ['TT-040-SUS-2D', 'M4', 8, ['1.35', '1.60', '1.85'], 'SUS304', 'A2-70相当', 'BOLT-2D-SUS304-A2-70'],
    ['TT-050-SUS-2D', 'M5', 10, ['2.70', '3.20', '3.70'], 'SUS304', 'A2-70相当', 'BOLT-2D-SUS304-A2-70'],
    ['TT-060-SUS-2D', 'M6', 12, ['4.70', '5.50', '6.30'], 'SUS304', 'A2-70相当', 'BOLT-2D-SUS304-A2-70'],
    ['TT-080-SUS-2D', 'M8', 16, ['11.00', '13.00', '15.00'], 'SUS304', 'A2-70相当', 'BOLT-2D-SUS304-A2-70']
  ] as const)('keeps the approved values for %s', (code, diameter, length, torque, material, strength, condition) => {
    const menu = findStandardTorqueTrainingMenu(code);
    expect(menu).toMatchObject({
      nominalDiameter: diameter,
      boltLengthMm: length,
      material,
      strengthClass: strength,
      lowerLimit: torque[0],
      nominalTorque: torque[1],
      upperLimit: torque[2],
      unit: 'N·m',
      jigConditionCode: condition
    });
    expect(menu?.displayName).toContain(condition);
  });
});
