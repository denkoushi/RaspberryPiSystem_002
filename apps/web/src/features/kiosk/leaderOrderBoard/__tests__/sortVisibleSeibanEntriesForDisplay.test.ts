import { describe, expect, it } from 'vitest';

import { sortVisibleSeibanEntriesForDisplay } from '../sortVisibleSeibanEntriesForDisplay';

import type { VisibleSeibanEntry } from '../deriveVisibleSeibanEntries';

describe('sortVisibleSeibanEntriesForDisplay', () => {
  it('共有履歴登録済みを先頭にし、同一グループ内は製番昇順', () => {
    const entries: VisibleSeibanEntry[] = [
      { fseiban: 'B', machineName: '' },
      { fseiban: 'A', machineName: '' }
    ];
    const registered = new Set(['B']);
    expect(sortVisibleSeibanEntriesForDisplay(entries, registered)).toEqual([
      { fseiban: 'B', machineName: '' },
      { fseiban: 'A', machineName: '' }
    ]);
  });

  it('登録状態が同じなら製番の昇順（numeric）', () => {
    const entries: VisibleSeibanEntry[] = [
      { fseiban: '10', machineName: '' },
      { fseiban: '2', machineName: '' }
    ];
    expect(sortVisibleSeibanEntriesForDisplay(entries, new Set())).toEqual([
      { fseiban: '2', machineName: '' },
      { fseiban: '10', machineName: '' }
    ]);
  });
});
