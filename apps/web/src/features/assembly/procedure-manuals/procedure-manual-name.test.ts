import { describe, expect, it } from 'vitest';

import { splitProcedureManualName } from './procedure-manual-name';

describe('splitProcedureManualName', () => {
  it.each([
    ['主軸_P-123_加工_研削', ''],
    ['主軸_P-123_加工_研削_仕上げ', '仕上げ'],
    ['主軸_P-123_加工_研削_仕上げ_最終_確認', '仕上げ 最終 確認'],
    ['  主軸 _ P-123 _ 加工 _ 研削 _ 仕上げ _ 最終  ', '仕上げ 最終'],
    ['主軸_P-123_加工_研削_   ', '']
  ])('splits four or more trimmed fields: %s', (name, supplement) => {
    expect(splitProcedureManualName(name)).toEqual({ partName: '主軸', subjectKey: 'P-123', process: '加工', work: '研削', supplement });
  });

  it.each(['', '旧名称', '対象_作業', 'DFD1_組立_検査', '  _  _  '])('returns null for fewer than four fields: %s', name => {
    expect(splitProcedureManualName(name)).toBeNull();
  });

  it('keeps empty fields in their original positions', () => {
    expect(splitProcedureManualName('主軸__加工_')).toEqual({ partName: '主軸', subjectKey: '', process: '加工', work: '', supplement: '' });
  });
});
