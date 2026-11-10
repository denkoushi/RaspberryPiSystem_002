import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlanningBoardSeibanPane } from '../grindingPlanningBoard/PlanningBoardSeibanPane';
import { mkLeaderBoardRow } from '../leaderOrderBoard/__tests__/leaderBoardRowTestFixtures';
import { LeaderOrderResourceRow } from '../leaderOrderBoard/LeaderOrderResourceRow';

import { DScheduleMinutesContext, type BoardDueSource } from './DScheduleMinutesContext';

const extras = { fseiban: 'BA123456', outsourceMarks: ['Y', 'Z'], surfaceSendOutDates: [{ date: '2026-11-10', note: 'CT以外' }], memo: '協力会社メモ' };
const noop = vi.fn();
const pane = <PlanningBoardSeibanPane fseiban={extras.fseiban} machineName="機種" items={[]} allocation="alternate" selectedItemIds={new Set()} isOpen={false} isFocused={false} onToggleOpen={noop} onFocus={noop} onToggleAll={noop} onToggleItem={noop} onResourceClick={noop} />;
const row = <LeaderOrderResourceRow resourceCd="305" orderUsageNumbers={undefined} row={mkLeaderBoardRow({ fseiban: extras.fseiban, seibanJoinKey: extras.fseiban, customerName: '顧客' })} onOrderChange={noop} onCompleteRow={noop} completePending={false} orderPending={false} />;

describe('D schedule extras on both boards', () => {
  it.each([['planning', pane], ['leader', row]])('%s shows marks and memo only for Excel and stars for both sources', (_name, component) => {
    const wrap = (dueSource: BoardDueSource) => <DScheduleMinutesContext.Provider value={{ dueSource, rows: new Map([[extras.fseiban, extras]]) }}>{component}</DScheduleMinutesContext.Provider>;
    const { rerender } = render(wrap('excel'));
    expect(screen.getByText('(YZ)')).toHaveClass('text-amber-300');
    expect(screen.getByText('★11/10')).toBeInTheDocument();
    expect(screen.getByText('CT以外')).toBeInTheDocument();
    expect(screen.getByText(extras.memo)).toBeInTheDocument();
    rerender(wrap('scaw'));
    expect(screen.queryByText('(YZ)')).not.toBeInTheDocument();
    expect(screen.queryByText(extras.memo)).not.toBeInTheDocument();
    expect(screen.getByText('★11/10')).toBeInTheDocument();
  });
});
