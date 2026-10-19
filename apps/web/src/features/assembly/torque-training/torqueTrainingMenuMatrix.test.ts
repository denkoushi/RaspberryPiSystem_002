import { describe, expect, it } from 'vitest';

import { buildTorqueTrainingMatrix } from './torqueTrainingMenuMatrix';

const version = (id: string, nominalDiameter: string, boltLengthMm: string, material: string, strengthClass = '12.9') => ({
  id,
  nominalDiameter,
  boltLengthMm,
  material,
  strengthClass
});

describe('buildTorqueTrainingMatrix', () => {
  it('orders diameters numerically and keeps materials as rows', () => {
    const matrix = buildTorqueTrainingMatrix([
      version('cs-m10', 'M10', '20', '炭素鋼'),
      version('cs-m2.5', 'M2.5', '5', '炭素鋼'),
      version('sus-m3', 'M3', '6', 'SUS304', 'A2-70相当'),
      version('cs-m3', 'M3', '6', '炭素鋼')
    ]);
    expect(matrix.columns.map((column) => column.nominalDiameter)).toEqual(['M2.5', 'M3', 'M10']);
    expect(matrix.rows.map((row) => row.material)).toEqual(['炭素鋼', 'SUS304']);
    expect(matrix.rows[0]!.cells.map((cell) => cell?.id ?? null)).toEqual(['cs-m2.5', 'cs-m3', 'cs-m10']);
    expect(matrix.rows[1]!.cells.map((cell) => cell?.id ?? null)).toEqual([null, 'sus-m3', null]);
  });

  it('adds a row instead of hiding a second menu in the same cell', () => {
    const matrix = buildTorqueTrainingMatrix([
      version('a', 'M6', '20', 'SCM435'),
      version('b', 'M6', '20', 'SCM435'),
      version('c', 'M8', '16', 'SCM435')
    ]);
    expect(matrix.rows).toHaveLength(2);
    expect(matrix.rows[0]!.cells.map((cell) => cell?.id ?? null)).toEqual(['a', 'c']);
    expect(matrix.rows[1]!.cells.map((cell) => cell?.id ?? null)).toEqual(['b', null]);
  });
});
