import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { DScheduleMinutesContext } from '../../productionSchedule/DScheduleMinutesContext';
import { normalizeMachineName } from '../../productionSchedule/machineName';

import { ganttResourceLabel } from './ganttResourceLabel';
import { planningBoardVisibleBars, type GanttLayout } from './planningBoardGanttLayout';
import { planningBoardSendOutRows } from './planningBoardLateStars';
import { PlanningBoardSendOutButton, type SendOutPopupPosition } from './PlanningBoardSendOutPopup';

/** Per-machine send-out rows, the open popup, and the brief highlight of a bar picked from it. */
export function usePlanningBoardSendOut(layout: GanttLayout, resourceNameMap: Readonly<Record<string, readonly string[]>>) {
  const { rows: minutesRows } = useContext(DScheduleMinutesContext);
  const byResource = useMemo(() => {
    const visible = new Set(planningBoardVisibleBars(layout));
    return new Map(layout.groups.flatMap((group) => group.resource === null ? [] : [
      [group.resource, { label: ganttResourceLabel(normalizeMachineName(group.label), resourceNameMap[group.resource]),
        rows: planningBoardSendOutRows(group.rows.flatMap((row) => row.bars).filter((bar) => visible.has(bar)), minutesRows) }] as const
    ]));
  }, [layout, minutesRows, resourceNameMap]);
  const position = useRef<SendOutPopupPosition | undefined>(undefined);
  const [opened, setOpened] = useState<{ resource: string; trigger: HTMLButtonElement } | null>(null);
  const toggle = useCallback((resource: string, trigger: HTMLButtonElement) => {
    setOpened((current) => current?.resource === resource ? null : { resource, trigger });
  }, []);
  const close = useCallback(() => {
    opened?.trigger.focus({ preventScroll: true });
    setOpened(null);
  }, [opened]);
  const resource = opened?.resource;
  const active = resource ? byResource.get(resource) : undefined;
  useEffect(() => { if (resource && !active?.rows.length) setOpened(null); }, [resource, active]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = useCallback((itemId: string) => {
    clearTimeout(timer.current);
    setFocusId(itemId);
    timer.current = setTimeout(() => setFocusId(null), 1200);
  }, []);
  const button = useCallback((target: string) => {
    const entry = byResource.get(target);
    return entry?.rows.length ? <PlanningBoardSendOutButton label={entry.label} count={entry.rows.length}
      open={target === resource} onToggle={(event) => toggle(target, event.currentTarget)} /> : null;
  }, [byResource, resource, toggle]);
  return { byResource, position, resource, active, toggle, close, focusId, flash, button };
}

type LabelEntry = { text: string; count: number; open: boolean; node: ReactNode };

/** Machine labels with their send-out count, reusing each label node until its text, count or open state changes. */
export function usePlanningBoardSendOutLabels(groups: GanttLayout['groups'], sendOut: ReturnType<typeof usePlanningBoardSendOut>,
  render: (resource: string, label: string, count: number, open: boolean) => ReactNode) {
  const previous = useRef<{ render: typeof render; labels: Map<string, LabelEntry> } | null>(null);
  const { byResource, resource: openResource } = sendOut;
  const labels = useMemo(() => new Map(groups.filter((group) => group.resource).map((group) => {
    const old = previous.current?.render === render ? previous.current.labels.get(group.resource!) : undefined;
    const entry = byResource.get(group.resource!)!;
    const count = entry.rows.length;
    const open = openResource === group.resource;
    return [group.resource!, old?.text === entry.label && old.count === count && old.open === open ? old :
      { text: entry.label, count, open, node: render(group.resource!, entry.label, count, open) }];
  })), [groups, render, byResource, openResource]);
  useLayoutEffect(() => { previous.current = { render, labels }; }, [render, labels]);
  return labels;
}
