import { describe, expect, it } from 'vitest';

import { planningBoardSeibanColor } from './planningBoardSeibanColor';

describe('planningBoardSeibanColor', () => {
  it('uses registered order and wraps the palette', () => {
    const order = Array.from({ length: 11 }, (_, index) => `26-${index}`);
    expect(planningBoardSeibanColor(order[0]!, order)).toBe('bg-sky-400');
    expect(planningBoardSeibanColor(order[1]!, order)).toBe('bg-amber-400');
    expect(new Set(order.slice(0, 10).map((seiban) => planningBoardSeibanColor(seiban, order))).size).toBe(10);
    expect(planningBoardSeibanColor(order[10]!, order)).toBe(planningBoardSeibanColor(order[0]!, order));
  });
  it('uses neutral slate for unassigned seiban, even when registered', () => {
    expect(planningBoardSeibanColor('********', [])).toBe('bg-slate-400');
    expect(planningBoardSeibanColor('********', ['********'])).toBe('bg-slate-400');
  });
  it('hashes missing seibans independently of other registered seibans', () => {
    for (const seiban of ['', '26-1041', '製番-長い名前-123456789']) {
      const color = planningBoardSeibanColor(seiban, []);
      expect(color).toMatch(/^bg-/);
      expect(planningBoardSeibanColor(seiban, ['other', 'seiban'])).toBe(color);
    }
    expect(planningBoardSeibanColor('26-1041', [])).not.toBe(planningBoardSeibanColor('26-1042', []));
  });
});
