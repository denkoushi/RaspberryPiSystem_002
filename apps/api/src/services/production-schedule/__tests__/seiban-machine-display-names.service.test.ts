import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL } from '../constants.js';
import { resolveSeibanMachineDisplayNames } from '../seiban-machine-display-names.service.js';
import { fetchSeibanProgressRows } from '../seiban-progress.service.js';

const findByFseibans = vi.fn();

vi.mock('../seiban-progress.service.js', () => ({
  fetchSeibanProgressRows: vi.fn()
}));

vi.mock('../seiban-machine-name-supplement.repository.js', () => ({
  SeibanMachineNameSupplementRepository: vi.fn().mockImplementation(() => ({
    findByFseibans,
  })),
}));

describe('resolveSeibanMachineDisplayNames', () => {
  beforeEach(() => {
    vi.mocked(fetchSeibanProgressRows).mockReset();
    findByFseibans.mockReset();
    findByFseibans.mockResolvedValue(new Map());
  });

  it('空入力は空オブジェクトを返す', async () => {
    const r = await resolveSeibanMachineDisplayNames([]);
    expect(r.machineNames).toEqual({});
    expect(fetchSeibanProgressRows).not.toHaveBeenCalled();
    expect(findByFseibans).not.toHaveBeenCalled();
  });

  it('fetchSeibanProgressRows の結果で machineNames を埋め、不足は補完→未登録ラベル', async () => {
    vi.mocked(fetchSeibanProgressRows).mockResolvedValue([
      { fseiban: 'A-1', total: 1, completed: 0, incompleteProductNames: [], machineName: '機種X' },
      { fseiban: 'B-2', total: 2, completed: 1, incompleteProductNames: ['p'], machineName: null }
    ]);
    findByFseibans.mockResolvedValue(new Map([['B-2', '補完Y']]));

    const r = await resolveSeibanMachineDisplayNames(['A-1', 'B-2']);

    expect(fetchSeibanProgressRows).toHaveBeenCalledWith(['A-1', 'B-2']);
    expect(findByFseibans).toHaveBeenCalledWith(['B-2']);
    expect(r.machineNames).toEqual({
      'A-1': '機種X',
      'B-2': '補完Y'
    });
  });

  it('MH/SH が無く補完も無い場合は機種名未登録', async () => {
    vi.mocked(fetchSeibanProgressRows).mockResolvedValue([
      { fseiban: 'B-2', total: 2, completed: 1, incompleteProductNames: ['p'], machineName: null }
    ]);
    findByFseibans.mockResolvedValue(new Map());

    const r = await resolveSeibanMachineDisplayNames(['B-2']);
    expect(r.machineNames).toEqual({
      'B-2': SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL
    });
  });

  it('既存の機種名が空文字でも補完で上書きできる', async () => {
    vi.mocked(fetchSeibanProgressRows).mockResolvedValue([
      { fseiban: 'C-3', total: 1, completed: 0, incompleteProductNames: [], machineName: '' }
    ]);
    findByFseibans.mockResolvedValue(new Map([['C-3', '補完Z']]));

    const r = await resolveSeibanMachineDisplayNames(['C-3']);
    expect(r.machineNames).toEqual({ 'C-3': '補完Z' });
  });

  it('入力は 100 件までは保持し、trim と重複除去だけ行う', async () => {
    const inputs = [' A-1 ', ...Array.from({ length: 60 }, (_, i) => `S-${i + 1}`), 'A-1'];
    vi.mocked(fetchSeibanProgressRows).mockResolvedValue([]);

    await resolveSeibanMachineDisplayNames(inputs);

    expect(vi.mocked(fetchSeibanProgressRows)).toHaveBeenCalledWith([
      'A-1',
      ...Array.from({ length: 60 }, (_, i) => `S-${i + 1}`)
    ]);
  });
});
