import { describe, expect, it } from 'vitest';

import { presentManualOrderRow } from './manualOrderRowPresentation';

describe('presentManualOrderRow', () => {
  it('returns null when all fields are empty or whitespace', () => {
    expect(
      presentManualOrderRow({
        fseiban: '',
        fhincd: '  ',
        processLabel: '',
        machineName: '',
        partName: '\t'
      })
    ).toBeNull();
  });

  it('returns row A only (seiban + hincd + proc)', () => {
    const p = presentManualOrderRow({
      fseiban: ' BA1 ',
      fhincd: ' MD1 ',
      processLabel: '10',
      machineName: '',
      partName: ''
    });
    expect(p).not.toBeNull();
    expect(p!.seiban).toBe('BA1');
    expect(p!.hincd).toBe('MD1');
    expect(p!.proc).toBe('10');
    expect(p!.showRowA).toBe(true);
    expect(p!.showRowB).toBe(false);
    expect(p!.title).toBe('BA1 · MD1 · 10');
  });

  it('returns row A for part and row B for machine (normalized)', () => {
    const p = presentManualOrderRow({
      fseiban: '',
      fhincd: '',
      processLabel: '',
      machineName: 'abc',
      partName: 'シャフト'
    });
    expect(p!.showRowA).toBe(true);
    expect(p!.showRowB).toBe(true);
    expect(p!.mach).toBe('ABC');
    expect(p!.part).toBe('シャフト');
    expect(p!.title).toBe('シャフト · ABC');
  });

  it('returns row B for machine only after normalize', () => {
    const p = presentManualOrderRow({
      fseiban: '',
      fhincd: '',
      processLabel: '',
      machineName: '  x軸ベース ',
      partName: ''
    });
    expect(p!.showRowA).toBe(false);
    expect(p!.showRowB).toBe(true);
    expect(p!.mach).toBe('X軸ベース');
    expect(p!.title).toBe('X軸ベース');
  });

  it('returns row A for part only when machine normalizes to empty', () => {
    const p = presentManualOrderRow({
      fseiban: '',
      fhincd: '',
      processLabel: '',
      machineName: '   ',
      partName: '品B'
    });
    expect(p!.showRowA).toBe(true);
    expect(p!.showRowB).toBe(false);
    expect(p!.mach).toBe('');
    expect(p!.part).toBe('品B');
    expect(p!.title).toBe('品B');
  });

  it('returns both rows with full fields', () => {
    const p = presentManualOrderRow({
      fseiban: 'S1',
      fhincd: 'H1',
      processLabel: '10',
      machineName: '機種a',
      partName: '品B'
    });
    expect(p!.showRowA && p!.showRowB).toBe(true);
    expect(p!.mach).toBe('機種A');
    expect(p!.title).toBe('S1 · H1 · 10 · 品B · 機種A');
  });
});
