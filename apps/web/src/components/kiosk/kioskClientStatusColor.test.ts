import { describe, expect, it } from 'vitest';

import { kioskClientStatusColor } from './kioskClientStatusColor';

describe('kiosk client status color', () => {
  it.each([
    [48.2, 12, 'bg-inv-green'],
    [59.9, 59.9, 'bg-inv-green'],
    [60, 0, 'bg-inv-amber'],
    [null, 60, 'bg-inv-amber'],
    [69.9, 79.9, 'bg-inv-amber'],
    [70, 0, 'bg-inv-red'],
    [null, 80, 'bg-inv-red'],
    [60, 80, 'bg-inv-red'],
    [70, 60, 'bg-inv-red'],
    [null, 0, 'bg-inv-green']
  ])('maps temperature %s and load %s to %s', (temperature, cpuUsage, expected) => {
    expect(kioskClientStatusColor(temperature, cpuUsage)).toBe(expected);
  });
});
