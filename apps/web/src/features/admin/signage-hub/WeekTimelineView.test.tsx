import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { buildWeekTimelineBlocks } from './weekTimelineModel';
import { WeekTimelineView } from './WeekTimelineView';

import type { SignageSchedule } from '../../../api/client';

const schedule = (partial: Partial<SignageSchedule>): SignageSchedule => ({
  id: 's1',
  name: '自主検査KPI',
  contentType: 'TOOLS',
  pdfId: null,
  layoutConfig: null,
  targetClientKeys: [],
  dayOfWeek: [3],
  startTime: '13:00',
  endTime: '17:00',
  priority: 0,
  enabled: true,
  createdAt: '',
  updatedAt: '',
  ...partial,
});

describe('WeekTimelineView', () => {
  it('opens a schedule from its block and from the off-timeline list', () => {
    const onSelect = vi.fn();
    const timeline = buildWeekTimelineBlocks([schedule({})], null, new Date('2026-09-30T05:32:00.000Z'));
    render(
      <WeekTimelineView
        timeline={timeline}
        clientName="現場 Pi3"
        selectedScheduleId={null}
        onSelectSchedule={onSelect}
        offTimeline={[{ scheduleId: 's2', name: '休止中', reason: '無効' }]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '水曜 13:00から17:00 自主検査KPI を編集' }));
    expect(onSelect).toHaveBeenLastCalledWith('s1');
    fireEvent.click(screen.getByRole('button', { name: '休止中（無効）' }));
    expect(onSelect).toHaveBeenLastCalledWith('s2');
    expect(screen.getAllByText('予定なし')).toHaveLength(6);
  });
});
