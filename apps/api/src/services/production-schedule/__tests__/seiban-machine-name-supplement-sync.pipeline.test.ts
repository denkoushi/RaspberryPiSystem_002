import { describe, expect, it } from 'vitest';

import { buildLastWinsSeibanMachineNames, mapToCreateInputs } from '../seiban-machine-name-supplement-sync.pipeline.js';
import { PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID } from '../constants.js';

describe('buildLastWinsSeibanMachineNames', () => {
  it('同一 FSEIBAN の重複は末尾行（id 昇順で後ろ）の値が採用される', () => {
    const map = buildLastWinsSeibanMachineNames([
      { rowData: { FSEIBAN: 'S-1', FHINMEI_MH_SH: '先' } },
      { rowData: { FSEIBAN: 'S-1', FHINMEI_MH_SH: '後' } },
    ]);
    expect(map.get('S-1')).toBe('後');
  });

  it('最終行が空の機種名ならそのキーは空文字として残る（DB投入時はスキップ）', () => {
    const map = buildLastWinsSeibanMachineNames([
      { rowData: { FSEIBAN: 'S-2', FHINMEI_MH_SH: '有効' } },
      { rowData: { FSEIBAN: 'S-2', FHINMEI_MH_SH: '  ' } },
    ]);
    expect(map.get('S-2')).toBe('');
  });

  it('mapToCreateInputs は空機種名を除外する', () => {
    const last = new Map([
      ['a', 'X'],
      ['b', ''],
    ]);
    const inputs = mapToCreateInputs(last, PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      fseiban: 'a',
      machineName: 'X',
      sourceCsvDashboardId: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
    });
  });

  it('同一runの順序は createdAt/id 昇順を前提に末尾値を採用する', () => {
    const map = buildLastWinsSeibanMachineNames([
      { rowData: { FSEIBAN: 'S-3', FHINMEI_MH_SH: '1件目' } },
      { rowData: { FSEIBAN: 'S-4', FHINMEI_MH_SH: '別製番' } },
      { rowData: { FSEIBAN: 'S-3', FHINMEI_MH_SH: '最終値' } },
    ]);
    expect(map.get('S-3')).toBe('最終値');
    expect(map.get('S-4')).toBe('別製番');
  });
});
