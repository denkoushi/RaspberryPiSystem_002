import { describe, expect, it } from 'vitest';

import {
  buildZero2wPiSelectOptions,
  findDeviceIdOnShelf,
  piSelectionRequiresApply
} from '../zero2wPreset/zero2wPiSelectOptions';
import { ZERO2W_PI_CLEAR, ZERO2W_PI_UNCHANGED } from '../zero2wPreset/zero2wPiSelectValue';

const devices = [
  { id: 'pi-a', name: 'Pi-A', shelfCodeRaw: 'NW-01' },
  { id: 'pi-b', name: 'Pi-B', shelfCodeRaw: null },
  { id: 'pi-c', name: 'Pi-C', shelfCodeRaw: 'NW-02' }
];

describe('buildZero2wPiSelectOptions', () => {
  it('greys out devices assigned to another shelf', () => {
    const options = buildZero2wPiSelectOptions(devices, 'NW-01');
    const piC = options.find((o) => o.value === 'pi-c');
    const piA = options.find((o) => o.value === 'pi-a');
    expect(piC?.disabled).toBe(true);
    expect(piA?.disabled).toBe(false);
  });

  it('allows unassigned device', () => {
    const options = buildZero2wPiSelectOptions(devices, 'NW-01');
    const piB = options.find((o) => o.value === 'pi-b');
    expect(piB?.disabled).toBe(false);
  });

  it('includes clear and unchanged sentinels', () => {
    const options = buildZero2wPiSelectOptions(devices, 'NW-01');
    expect(options.some((o) => o.value === ZERO2W_PI_CLEAR)).toBe(true);
    expect(options.some((o) => o.value === ZERO2W_PI_UNCHANGED)).toBe(true);
  });
});

describe('piSelectionRequiresApply', () => {
  it('requires apply when selecting a different device', () => {
    expect(piSelectionRequiresApply('pi-b', 'pi-a')).toBe(true);
  });

  it('requires apply when clearing an assigned shelf', () => {
    expect(piSelectionRequiresApply(ZERO2W_PI_CLEAR, 'pi-a')).toBe(true);
  });

  it('does not require apply when unchanged', () => {
    expect(piSelectionRequiresApply(ZERO2W_PI_UNCHANGED, 'pi-a')).toBe(false);
    expect(piSelectionRequiresApply('pi-a', 'pi-a')).toBe(false);
  });
});

describe('findDeviceIdOnShelf', () => {
  it('finds device on target shelf', () => {
    expect(findDeviceIdOnShelf(devices, 'NW-01')).toBe('pi-a');
  });
});
