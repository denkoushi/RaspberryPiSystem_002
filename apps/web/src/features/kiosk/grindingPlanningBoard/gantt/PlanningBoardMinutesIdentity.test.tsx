import { render } from '@testing-library/react';
import { memo, useContext } from 'react';
import { expect, it, vi } from 'vitest';

import { DScheduleMinutesContext, DScheduleMinutesProvider } from '../../productionSchedule/DScheduleMinutesContext';

const query = vi.hoisted(() => vi.fn());
vi.mock('../../../../api/hooks/production-schedule/d-schedule-minutes', () => ({ useKioskDScheduleMinutes: query }));

it('preserves minutes context identity on equal refetch, and updates for any content or order change', () => {
  let data = { rows: [{ fseiban: 'A', outsourceMarks: ['1', '2'], memo: 'memo', surfaceSendOutDates: [{ date: '2026-11-05', note: 'note' }] },
    { fseiban: 'B', outsourceMarks: [], memo: '', surfaceSendOutDates: [] }] };
  query.mockImplementation(() => ({ data }));
  const contexts: Array<React.ContextType<typeof DScheduleMinutesContext>> = [];
  const Consumer = memo(function Consumer() { contexts.push(useContext(DScheduleMinutesContext)); return null; });
  const draw = (dueSource: 'excel' | 'scaw' = 'excel') => <DScheduleMinutesProvider dueSource={dueSource}><Consumer /></DScheduleMinutesProvider>;
  const view = render(draw());
  expect(contexts).toHaveLength(1);
  data = structuredClone(data);
  view.rerender(draw());
  expect(contexts).toHaveLength(1);
  data = { rows: data.rows.map((row, i) => i ? row : { ...row, surfaceSendOutDates: [{ date: '2026-11-06', note: 'changed' }] }) };
  view.rerender(draw());
  expect(contexts).toHaveLength(2);
  expect(contexts[1]!.rows.get('A')!.surfaceSendOutDates[0]).toEqual({ date: '2026-11-06', note: 'changed' });
  data = { rows: [...data.rows].reverse() };
  view.rerender(draw());
  expect(contexts).toHaveLength(3);
  expect([...contexts[2]!.rows.keys()]).toEqual(['B', 'A']);
  data = { rows: data.rows.map(row => ({ ...row, outsourceMarks: [...row.outsourceMarks].reverse() })) };
  view.rerender(draw());
  expect(contexts).toHaveLength(4);
  view.rerender(draw('scaw'));
  expect(contexts).toHaveLength(5);
  expect(contexts[4]!.dueSource).toBe('scaw');
});
