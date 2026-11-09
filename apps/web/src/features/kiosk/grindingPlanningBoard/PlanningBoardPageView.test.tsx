import { render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PlanningBoardPageView } from './PlanningBoardPageView';

import type { ComponentProps } from 'react';

const ganttView = vi.hoisted(() => vi.fn());
const unmount = vi.hoisted(() => vi.fn());
vi.mock('./gantt/PlanningBoardGanttView', () => ({ PlanningBoardGanttView: (props: unknown) => {
  ganttView(props);
  useEffect(() => unmount, []);
  return <div data-testid="gantt-viewport" />;
} }));

describe('PlanningBoardPageView', () => {
  it('disables gantt piece operations while writes are blocked', () => {
    const props = {
      data: { siteKey: 'site', resources: [] }, ganttEnabled: true, gantt: {},
      resourcesQuery: {}, pinMode: false, writeQueue: { pending: false }, allocation: 'alternate',
      interactionLocked: false, writeBlocked: false, specialDueMode: null
    } as ComponentProps<typeof PlanningBoardPageView>;
    const { rerender } = render(<PlanningBoardPageView {...props} />);
    expect(ganttView.mock.lastCall?.[0]).toEqual(expect.objectContaining({ pieceDisabled: false }));
    rerender(<PlanningBoardPageView {...props} writeBlocked />);
    expect(ganttView.mock.lastCall?.[0]).toEqual(expect.objectContaining({ pieceDisabled: true, disabled: false }));
  });
  it('keeps the viewport and prior axis with no rows or enabled writes during a scope switch', () => {
    const layout = { start: 1, end: 50, today: 20, groups: [{ rows: [{ bars: ['old-row'] }] }], forwardQueue: ['old-queue'] };
    const props = {
      data: { siteKey: 'site', resources: ['305'] }, ganttEnabled: true, gantt: {}, ganttLayout: layout,
      resourcesQuery: {}, writeQueue: { pending: false }, allocation: 'alternate',
      canMoveResource: vi.fn(() => true), rankMutationReady: true
    } as unknown as ComponentProps<typeof PlanningBoardPageView>;
    const view = render(<PlanningBoardPageView {...props} />);
    const viewport = screen.getByTestId('gantt-viewport');
    viewport.scrollLeft = 250;
    viewport.scrollTop = 100;
    unmount.mockClear();
    view.rerender(<PlanningBoardPageView {...props} data={undefined} ganttLayout={{ ...props.ganttLayout, start: 20, end: 21, groups: [] }} />);
    expect(unmount).not.toHaveBeenCalled();
    expect(screen.getByTestId('gantt-viewport')).toBe(viewport);
    const pending = ganttView.mock.lastCall![0];
    expect(pending.layout).toMatchObject({ start: 1, end: 50, groups: [], forwardQueue: [] });
    expect(pending).toMatchObject({ disabled: true, dragDisabled: true, pieceDisabled: true, preferenceScope: 'site:undefined', resourceMinutesItems: [] });
    expect(pending.canMoveResource({}, '305')).toBe(false);
    const next = { ...props.ganttLayout, groups: [] };
    view.rerender(<PlanningBoardPageView {...props} ganttLayout={next} />);
    expect(ganttView.mock.lastCall![0].layout).toBe(next);
    expect(screen.getByTestId('gantt-viewport')).toBe(viewport);
    expect(viewport.scrollLeft).toBe(250);
    expect(viewport.scrollTop).toBe(100);
    expect(unmount).not.toHaveBeenCalled();
  });

});
