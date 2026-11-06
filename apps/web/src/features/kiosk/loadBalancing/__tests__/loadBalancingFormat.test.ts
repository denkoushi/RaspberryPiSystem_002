import { describe, expect, it } from 'vitest';

import { buildWorkspaceMachineNames } from '../loadBalancingFormat';

describe('buildWorkspaceMachineNames', () => {
  it('merges normalized names and orders by total minutes, preserving ties', () => {
    const result = buildWorkspaceMachineNames([
      { machineName: ' ＧＨＬ－ｂ５２０Ｔ ', totalMinutes: 100 },
      { machineName: 'ghl-b520t', totalMinutes: 200 },
      { machineName: '精密研削盤', totalMinutes: 300 },
      { machineName: '機種名未登録', totalMinutes: 1 }
    ]);
    expect(result.machines).toEqual(['GHL-B520T', '精密研削盤', '機種名未登録']);
    expect(result.formattedNames.get(' ＧＨＬ－ｂ５２０Ｔ ')).toBe('GHL-B520T');
    expect(result.formattedNames.get('ghl-b520t')).toBe('GHL-B520T');
  });
});
