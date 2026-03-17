import { describe, expect, it } from 'vitest';

import {
  buildMachineToSeibanIndex,
  extractMachineNameOptions,
  extractPartNameOptions,
  filterRowsByMachineAndPart,
  normalizeScheduleRows
} from './displayRowDerivation';

const sourceRows = [
  {
    id: 'machine-row-1',
    rowData: { FSEIBAN: 'S001', FHINCD: 'MH001', FHINMEI: '機種A', FSIGENCD: '305' }
  },
  {
    id: 'machine-row-2',
    rowData: { FSEIBAN: 'S002', FHINCD: 'SH001', FHINMEI: '機種B', FSIGENCD: '100' }
  },
  {
    id: 'part-row-1',
    rowData: { FSEIBAN: 'S001', FHINCD: 'P001', FHINMEI: '部品X', FSIGENCD: '305' }
  },
  {
    id: 'part-row-2',
    rowData: { FSEIBAN: 'S001', FHINCD: 'P002', FHINMEI: '部品Y', FSIGENCD: '305' }
  },
  {
    id: 'part-row-3',
    rowData: { FSEIBAN: 'S002', FHINCD: 'P003', FHINMEI: '部品Z', FSIGENCD: '100' }
  }
];

describe('displayRowDerivation machine/part filters', () => {
  it('機種名候補を一意で抽出する', () => {
    expect(extractMachineNameOptions(sourceRows)).toEqual(['機種A', '機種B']);
  });

  it('機種名→部品名の絞り込みがANDで効く', () => {
    const machineToSeibanIndex = buildMachineToSeibanIndex(sourceRows);
    const rows = normalizeScheduleRows(sourceRows);

    const machineFiltered = filterRowsByMachineAndPart(rows, machineToSeibanIndex, '機種A', '');
    expect(machineFiltered.map((row) => row.data.FSEIBAN)).toEqual(['S001', 'S001']);
    expect(extractPartNameOptions(machineFiltered)).toEqual(['部品X', '部品Y']);

    const machineAndPartFiltered = filterRowsByMachineAndPart(rows, machineToSeibanIndex, '機種A', '部品Y');
    expect(machineAndPartFiltered).toHaveLength(1);
    expect(machineAndPartFiltered[0]?.data.FHINMEI).toBe('部品Y');
  });

  it('APIでmachineName絞り込み済みでMH/SH行が無い場合は部品を落とさない', () => {
    const apiFilteredPartRows = [
      {
        id: 'part-row-1',
        rowData: { FSEIBAN: 'S001', FHINCD: 'P001', FHINMEI: '部品X', FSIGENCD: '305' }
      },
      {
        id: 'part-row-2',
        rowData: { FSEIBAN: 'S001', FHINCD: 'P002', FHINMEI: '部品Y', FSIGENCD: '305' }
      }
    ];
    const machineToSeibanIndex = buildMachineToSeibanIndex(apiFilteredPartRows);
    const rows = normalizeScheduleRows(apiFilteredPartRows);

    const filtered = filterRowsByMachineAndPart(rows, machineToSeibanIndex, '機種A', '', {
      skipMachineFilterIfNoIndexHit: true
    });

    expect(filtered).toHaveLength(2);
    expect(extractPartNameOptions(filtered)).toEqual(['部品X', '部品Y']);
  });
});
