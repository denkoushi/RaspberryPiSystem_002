import { describe, expect, it } from 'vitest';
import { MI_INSTRUMENT_DETAIL_COLUMN } from '../mi-instrument-display.types.js';
import { parseLegacyInstrumentList, parseRowInstrumentEntries } from '../row-instrument-entries.js';
import type { MiLoanInspectionTableRow } from '../row-priority.js';

describe('parseLegacyInstrumentList', () => {
  it('parses 名称 (管理番号) tokens into active entries', () => {
    const entries = parseLegacyInstrumentList('デジタルノギス (AG001), マイクロメータ (AG002)');
    expect(entries).toEqual([
      { kind: 'active', managementNumber: 'AG001', name: 'デジタルノギス' },
      { kind: 'active', managementNumber: 'AG002', name: 'マイクロメータ' },
    ]);
  });

  it('uses whole token as name when parentheses pattern does not match', () => {
    const entries = parseLegacyInstrumentList('謎トークン');
    expect(entries).toEqual([{ kind: 'active', managementNumber: '', name: '謎トークン' }]);
  });
});

describe('parseRowInstrumentEntries', () => {
  it('prefers JSON column over legacy list', () => {
    const row: MiLoanInspectionTableRow = {
      従業員名: 'X',
      貸出中計測機器数: 1,
      計測機器名称一覧: '旧表示 (Z99)',
      [MI_INSTRUMENT_DETAIL_COLUMN]: JSON.stringify([
        { kind: 'active', managementNumber: 'K1', name: '新表示' },
      ]),
    };
    expect(parseRowInstrumentEntries(row)).toEqual([
      { kind: 'active', managementNumber: 'K1', name: '新表示' },
    ]);
  });

  it('falls back to legacy when JSON column is empty', () => {
    const row: MiLoanInspectionTableRow = {
      従業員名: 'X',
      貸出中計測機器数: 1,
      計測機器名称一覧: 'ノギス (MG1)',
    };
    expect(parseRowInstrumentEntries(row)).toEqual([
      { kind: 'active', managementNumber: 'MG1', name: 'ノギス' },
    ]);
  });

  it('drops empty entries from JSON payload', () => {
    const row: MiLoanInspectionTableRow = {
      従業員名: 'X',
      貸出中計測機器数: 1,
      計測機器名称一覧: '旧表示 (Z99)',
      [MI_INSTRUMENT_DETAIL_COLUMN]: JSON.stringify([
        { kind: 'active', managementNumber: '', name: '' },
        { kind: 'active', managementNumber: 'K1', name: '新表示' },
      ]),
    };
    expect(parseRowInstrumentEntries(row)).toEqual([
      { kind: 'active', managementNumber: 'K1', name: '新表示' },
    ]);
  });
});
