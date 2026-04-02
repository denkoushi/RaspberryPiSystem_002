import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveSeibanMachineDisplayNames } from '../seiban-machine-display-names.service.js';
import { fetchSeibanProgressRows } from '../seiban-progress.service.js';

vi.mock('../seiban-progress.service.js', () => ({
  fetchSeibanProgressRows: vi.fn()
}));

describe('resolveSeibanMachineDisplayNames', () => {
  beforeEach(() => {
    vi.mocked(fetchSeibanProgressRows).mockReset();
  });

  it('空入力は空オブジェクトを返す', async () => {
    const r = await resolveSeibanMachineDisplayNames([]);
    expect(r.machineNames).toEqual({});
    expect(fetchSeibanProgressRows).not.toHaveBeenCalled();
  });

  it('fetchSeibanProgressRows の結果で machineNames を埋める', async () => {
    vi.mocked(fetchSeibanProgressRows).mockResolvedValue([
      { fseiban: 'A-1', total: 1, completed: 0, incompleteProductNames: [], machineName: '機種X' },
      { fseiban: 'B-2', total: 2, completed: 1, incompleteProductNames: ['p'], machineName: null }
    ]);

    const r = await resolveSeibanMachineDisplayNames(['A-1', 'B-2']);

    expect(fetchSeibanProgressRows).toHaveBeenCalledWith(['A-1', 'B-2']);
    expect(r.machineNames).toEqual({
      'A-1': '機種X',
      'B-2': null
    });
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
