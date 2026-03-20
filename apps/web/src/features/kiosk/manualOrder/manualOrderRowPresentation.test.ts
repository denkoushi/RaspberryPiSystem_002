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

  it('returns presentation with line1 only (seiban + hincd)', () => {
    const p = presentManualOrderRow({
        fseiban: ' BA1 ',
        fhincd: ' MD1 ',
        processLabel: '',
        machineName: '',
        partName: ''
      });
    expect(p).not.toBeNull();
    expect(p!.seiban).toBe('BA1');
    expect(p!.hincd).toBe('MD1');
    expect(p!.showLine1).toBe(true);
    expect(p!.showLine2).toBe(false);
    expect(p!.showLine3).toBe(false);
    expect(p!.title).toBe('BA1 · MD1');
  });

  it('returns line2 for process and part with separator logic', () => {
    const p = presentManualOrderRow({
        fseiban: '',
        fhincd: '',
        processLabel: '200',
        machineName: '',
        partName: 'シャフト'
      });
    expect(p!.showLine2).toBe(true);
    expect(p!.proc).toBe('200');
    expect(p!.part).toBe('シャフト');
    expect(p!.title).toBe('200 · シャフト');
  });

  it('returns line3 for machine only (no line1/2)', () => {
    const p = presentManualOrderRow({
        fseiban: '',
        fhincd: '',
        processLabel: '',
        machineName: '  X軸ベース ',
        partName: ''
      });
    expect(p!.showLine3).toBe(true);
    expect(p!.mach).toBe('X軸ベース');
    expect(p!.title).toBe('X軸ベース');
  });

  it('returns full three lines', () => {
    const p = presentManualOrderRow({
        fseiban: 'S1',
        fhincd: 'H1',
        processLabel: '10',
        machineName: '機種A',
        partName: '品B'
      });
    expect(p!.showLine1 && p!.showLine2 && p!.showLine3).toBe(true);
    expect(p!.title).toBe('S1 · H1 · 10 · 品B · 機種A');
  });
});
