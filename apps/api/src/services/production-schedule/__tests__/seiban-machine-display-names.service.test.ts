import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL } from '../constants.js';
import {
  resolveSeibanMachineDisplayNames,
  resolveSeibanMachineDisplayNamesBatched,
  resolveSeibanMachineDisplayNamesForWinnerRows,
} from '../seiban-machine-display-names.service.js';
import { fetchSeibanProgressRows } from '../seiban-progress.service.js';

const findByFseibans = vi.fn();
const queryRaw = vi.fn();

vi.mock('../../../lib/prisma.js', () => ({
  prisma: { $queryRaw: (...args: unknown[]) => queryRaw(...args) }
}));

vi.mock('../seiban-progress.service.js', () => ({
  fetchSeibanProgressRows: vi.fn()
}));

vi.mock('../seiban-machine-name-supplement.repository.js', () => ({
  SeibanMachineNameSupplementRepository: vi.fn().mockImplementation(function () {
    return { findByFseibans };
  }),
}));

/** 機種名クエリに渡した製番（tagged template の 2 番目の値が IN リスト） */
const queriedSeibans = (callIndex = 0): unknown[] =>
  (queryRaw.mock.calls[callIndex]?.[2] as Prisma.Sql).values;

describe('resolveSeibanMachineDisplayNames', () => {
  beforeEach(() => {
    queryRaw.mockReset();
    queryRaw.mockResolvedValue([]);
    vi.mocked(fetchSeibanProgressRows).mockReset();
    findByFseibans.mockReset();
    findByFseibans.mockResolvedValue(new Map());
  });

  it('空入力は空オブジェクトを返す', async () => {
    const r = await resolveSeibanMachineDisplayNames([]);
    expect(r.machineNames).toEqual({});
    expect(queryRaw).not.toHaveBeenCalled();
    expect(findByFseibans).not.toHaveBeenCalled();
  });

  it('進捗集計を使わず機種名だけを 1 回のクエリで引く', async () => {
    await resolveSeibanMachineDisplayNames(['A-1']);

    expect(fetchSeibanProgressRows).not.toHaveBeenCalled();
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const sqlText = (queryRaw.mock.calls[0]?.[0] as string[]).join('?');
    expect(sqlText).not.toContain('ProductionScheduleProgress');
    expect(sqlText).toContain("LIKE 'MH%'");
    expect(sqlText).toContain("LIKE 'SH%'");
  });

  it('MH/SH 行の機種名で machineNames を埋め、不足は補完→未登録ラベル', async () => {
    queryRaw.mockResolvedValue([{ fseiban: 'A-1', machineName: '機種X' }]);
    findByFseibans.mockResolvedValue(new Map([['B-2', '補完Y']]));

    const r = await resolveSeibanMachineDisplayNames(['A-1', 'B-2']);

    expect(queriedSeibans()).toEqual(['A-1', 'B-2']);
    expect(findByFseibans).toHaveBeenCalledWith(['B-2']);
    expect(r.machineNames).toEqual({
      'A-1': '機種X',
      'B-2': '補完Y'
    });
  });

  it('MH/SH が無く補完も無い場合は機種名未登録', async () => {
    const r = await resolveSeibanMachineDisplayNames(['B-2']);
    expect(r.machineNames).toEqual({
      'B-2': SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL
    });
  });

  it('既存の機種名が空文字でも補完で上書きできる', async () => {
    queryRaw.mockResolvedValue([{ fseiban: 'C-3', machineName: '' }]);
    findByFseibans.mockResolvedValue(new Map([['C-3', '補完Z']]));

    const r = await resolveSeibanMachineDisplayNames(['C-3']);
    expect(r.machineNames).toEqual({ 'C-3': '補完Z' });
  });

  it('MH/SH の未登録ラベルも未解決として扱い、後日の補完値で上書きできる', async () => {
    queryRaw.mockResolvedValue([{ fseiban: 'D-4', machineName: SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL }]);
    findByFseibans.mockResolvedValue(new Map([['D-4', '後日解決した正本機種名']]));

    const r = await resolveSeibanMachineDisplayNames(['D-4']);

    expect(findByFseibans).toHaveBeenCalledWith(['D-4']);
    expect(r.machineNames).toEqual({ 'D-4': '後日解決した正本機種名' });
  });

  it('入力は 100 件までは保持し、trim と重複除去だけ行う', async () => {
    const inputs = [' A-1 ', ...Array.from({ length: 60 }, (_, i) => `S-${i + 1}`), 'A-1'];

    await resolveSeibanMachineDisplayNames(inputs);

    expect(queriedSeibans()).toEqual(['A-1', ...Array.from({ length: 60 }, (_, i) => `S-${i + 1}`)]);
  });
});

describe('resolveSeibanMachineDisplayNamesBatched', () => {
  beforeEach(() => {
    queryRaw.mockReset();
    findByFseibans.mockReset();
    findByFseibans.mockResolvedValue(new Map());
  });

  it('100件超の入力を分割して解決し、全件を返す', async () => {
    queryRaw.mockImplementation(async (_strings: string[], _id: unknown, seibans: Prisma.Sql) =>
      (seibans.values as string[]).map((fseiban) => ({ fseiban, machineName: `機種-${fseiban}` }))
    );

    const inputs = Array.from({ length: 130 }, (_, i) => `S-${i + 1}`);
    const result = await resolveSeibanMachineDisplayNamesBatched(inputs);

    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(queriedSeibans(0)).toHaveLength(100);
    expect(queriedSeibans(1)).toHaveLength(30);
    expect(Object.keys(result.machineNames)).toHaveLength(130);
    expect(result.machineNames['S-1']).toBe('機種-S-1');
    expect(result.machineNames['S-130']).toBe('機種-S-130');
  });
});

describe('resolveSeibanMachineDisplayNamesForWinnerRows', () => {
  beforeEach(() => {
    queryRaw.mockReset();
    findByFseibans.mockReset();
    findByFseibans.mockResolvedValue(new Map());
    vi.mocked(fetchSeibanProgressRows).mockReset();
  });

  it('引く製番が無ければクエリしない', async () => {
    expect(await resolveSeibanMachineDisplayNamesForWinnerRows({ fseibans: [' ', ''], winnerRowIds: ['r1'] })).toEqual({
      machineNames: {}
    });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('100 件を超えても 1 回のクエリで引き、進捗集計は使わず、MH/SH → 補完 → 未登録の順で埋める', async () => {
    const fseibans = Array.from({ length: 250 }, (_, index) => `S-${index}`);
    queryRaw.mockResolvedValue([
      { fseiban: 'S-0', machineName: 'NVD-5000' },
      { fseiban: 'S-1', machineName: '' }
    ]);
    findByFseibans.mockResolvedValue(new Map([['S-1', 'HX-630']]));

    const { machineNames } = await resolveSeibanMachineDisplayNamesForWinnerRows({ fseibans, winnerRowIds: ['r1', 'r2'] });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(fetchSeibanProgressRows).not.toHaveBeenCalled();
    expect(Object.keys(machineNames)).toHaveLength(250);
    expect(machineNames['S-0']).toBe('NVD-5000');
    expect(machineNames['S-1']).toBe('HX-630');
    expect(machineNames['S-249']).toBe(SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL);
    expect(findByFseibans).toHaveBeenCalledTimes(1);
    expect(findByFseibans.mock.calls[0]![0]).toHaveLength(249);
  });
});
