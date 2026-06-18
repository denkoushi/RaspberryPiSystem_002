import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LeaderOrderResourceRow } from '../LeaderOrderResourceRow';

import { mkLeaderBoardRow } from './leaderBoardRowTestFixtures';

const noop = vi.fn();

describe('LeaderOrderResourceRow', () => {
  it('exposes full trimmed part name via title when fseiban truncates the row', () => {
    const longPartName = '  超長い品名テスト部品ABCDEFGHIJKLMNOPQRSTUVWXYZ  ';
    const trimmedPartName = longPartName.trim();
    const row = mkLeaderBoardRow({
      id: 'row-long-part',
      fseiban: 'BA123456',
      fhinmei: longPartName
    });

    render(
      <LeaderOrderResourceRow
        resourceCd="305"
        row={row}
        orderUsageNumbers={undefined}
        onOrderChange={noop}
        onCompleteRow={noop}
        completePending={false}
        orderPending={false}
      />
    );

    const partNameEl = screen.getByText(trimmedPartName);
    expect(partNameEl).toHaveAttribute('title', trimmedPartName);
    expect(partNameEl).toHaveClass('truncate');
    expect(screen.getByText('BA123456')).toBeInTheDocument();
  });

  it('exposes note text via title on the remark button when note is present', () => {
    const note = '急ぎ対応。再加工注意。';
    const row = mkLeaderBoardRow({
      id: 'row-note',
      fseiban: 'BA123456',
      fhinmei: '部品A',
      note
    });

    render(
      <LeaderOrderResourceRow
        resourceCd="305"
        row={row}
        orderUsageNumbers={undefined}
        onOrderChange={noop}
        onCompleteRow={noop}
        completePending={false}
        orderPending={false}
        onOpenNote={noop}
      />
    );

    expect(screen.getByRole('button', { name: '備考を編集。ホバーで全文を表示' })).toHaveAttribute('title', note);
  });
});
