import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LeaderBoardLeftToolStack, type LeaderBoardLeftToolStackProps } from '../LeaderBoardLeftToolStack';
import { usePersistedLeaderBoardScawMode } from '../usePersistedLeaderBoardScawMode';

import type { LeaderBoardDueAssistHandle } from '../useLeaderBoardDueAssist';

const noop = vi.fn();
const props: LeaderBoardLeftToolStackProps = {
  leftToolStackOuterRef: createRef(), drawerReveal: { isVisible: true, onDrawerMouseEnter: noop, onDrawerMouseLeave: noop, onHotZoneEnter: noop },
  siteKey: 'site', defaultSites: ['site'], handleSiteChange: noop, activeDeviceScopeKey: 'device', setActiveDeviceScopeKey: noop, setSelectedResourceCd: noop, deviceCards: [],
  dueAssist: { searchInput: '', selectedFseibanFilters: [], detailQuery: {}, isDetailOpen: false } as unknown as LeaderBoardDueAssistHandle,
  searchConditions: { showGrindingResources: true, showCuttingResources: false }, toggleGrinding: noop, toggleCutting: noop,
  completionFilter: 'incomplete', setCompletionFilter: noop, selectedResourceCategory: undefined, activeResourceCds: [], slotCount: 1, setSlotModalOpen: noop,
  selectedResourceCd: null, listIncomplete: false, isSeibanListPanelOpen: false, onToggleSeibanListPanel: noop, seibanEvalEnabled: false, onToggleSeibanEval: noop,
  registeredSeibansForDisplay: [], onMoveRegisteredSeibanToRank: noop, ganttEnabled: false, onToggleGanttMode: noop, splitFeatureStatus: { label: '', className: '' }
};
function Harness() {
  const { scawEnabled, toggleScawMode } = usePersistedLeaderBoardScawMode('site', 'device');
  return <LeaderBoardLeftToolStack {...props} scawEnabled={scawEnabled} onToggleScawMode={toggleScawMode} />;
}
beforeEach(() => localStorage.clear());
describe('leaderboard SCAW button', () => {
  it('follows Gantt and toggles its persisted pressed state', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'SCAW' });
    expect(toggle.previousElementSibling).toBe(screen.getByRole('button', { name: 'ガント表示をオンにする' }));
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveClass('bg-sky-500');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });
});
