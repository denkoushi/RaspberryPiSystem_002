import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlanningBoardPageView } from './PlanningBoardPageView';

import type { ComponentProps } from 'react';

const ganttView = vi.hoisted(() => vi.fn<(props: { pieceDisabled?: boolean; disabled?: boolean; chainItems?: unknown }) => null>(() => null));
vi.mock('./gantt/PlanningBoardGanttView', () => ({ PlanningBoardGanttView: ganttView }));

describe('PlanningBoardPageView', () => {
  it('disables gantt piece operations while writes are blocked', () => {
    const props = {
      data: { siteKey: 'site', resources: [], items: [{ itemId: 'completed-piece', kind: 'piece', isCompleted: true }] }, ganttEnabled: true, gantt: { testBarControls: { disabled: false } }, ganttLayout: { mode: 'forward', groups: [] },
      resourcesQuery: {}, pinMode: false, writeQueue: { pending: false }, allocation: 'alternate',
      interactionLocked: false, writeBlocked: false, specialDueMode: null
    } as ComponentProps<typeof PlanningBoardPageView>;
    const { rerender } = render(<PlanningBoardPageView {...props} />);
    expect(ganttView.mock.lastCall?.[0]).toEqual(expect.objectContaining({ chainItems: props.data?.items, pieceDisabled: false, testBarControls: expect.objectContaining({ disabled: false }) }));
    rerender(<PlanningBoardPageView {...props} writeBlocked />);
    expect(ganttView.mock.lastCall?.[0]).toEqual(expect.objectContaining({ pieceDisabled: true, disabled: false, testBarControls: expect.objectContaining({ disabled: true }) }));
  });
});
