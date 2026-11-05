import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePersistedArrivalFilter } from '../../usePersistedArrivalFilter';
import { LeaderBoardLeftToolStack, type LeaderBoardLeftToolStackProps } from '../LeaderBoardLeftToolStack';

vi.mock('../LeaderBoardDueAssistPanel', () => ({ LeaderBoardDueAssistPanel: () => null }));
vi.mock('../../productionSchedule/SeibanSearchRegister', () => ({ SeibanSearchRegister: () => null }));
const noop = vi.fn();
const props: LeaderBoardLeftToolStackProps = {
  leftToolStackOuterRef: { current: null }, drawerReveal: { isVisible: true, onDrawerMouseEnter: noop, onDrawerMouseLeave: noop, onHotZoneEnter: noop },
  siteKey: 'site', defaultSites: ['site'], handleSiteChange: noop, activeDeviceScopeKey: 'terminal', setActiveDeviceScopeKey: noop,
  setSelectedResourceCd: noop, deviceCards: [],
  dueAssist: { selectedFseibanFilters: [], selectedFseiban: null, detailQuery: {} } as unknown as LeaderBoardLeftToolStackProps['dueAssist'],
  searchConditions: { showGrindingResources: true, showCuttingResources: false }, toggleGrinding: noop, toggleCutting: noop,
  completionFilter: 'incomplete', setCompletionFilter: noop, selectedResourceCategory: 'grinding', activeResourceCds: [], slotCount: 1,
  setSlotModalOpen: noop, selectedResourceCd: null, listIncomplete: false, isSeibanListPanelOpen: false, onToggleSeibanListPanel: noop,
  seibanEvalEnabled: false, onToggleSeibanEval: noop, registeredSeibansForDisplay: [], onMoveRegisteredSeibanToRank: noop,
  ganttEnabled: true, onToggleGanttMode: noop, splitFeatureStatus: { label: '', className: '' }
};
function Tools() {
  const { arrivalFilterEnabled, toggleArrivalFilter } = usePersistedArrivalFilter('leader:site\0terminal');
  return <LeaderBoardLeftToolStack {...props} arrivalFilterEnabled={arrivalFilterEnabled} onToggleArrivalFilter={toggleArrivalFilter} />;
}

describe('leader arrival toggle', () => {
  beforeEach(() => localStorage.clear());
  it('sits beside SCAW, defaults ON, toggles and persists independently from the planning board', () => {
    const first = render(<Tools />);
    const button = screen.getByRole('button', { name: '前工程が済んだものだけ表示' });
    expect(button.previousElementSibling).toBe(screen.getByRole('button', { name: 'SCAW' }));
    expect(button).toHaveTextContent('着');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'false');
    first.unmount();
    render(<Tools />);
    expect(screen.getByRole('button', { name: '前工程が済んだものだけ表示' })).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem('kiosk-planning-board-arrival-filter')).toBeNull();
  });
});
