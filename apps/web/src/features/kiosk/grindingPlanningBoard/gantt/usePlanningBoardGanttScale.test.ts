import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ganttScaleLabel, usePlanningBoardGanttScale } from './usePlanningBoardGanttScale';

describe('usePlanningBoardGanttScale', () => {
  it('毎回1日で開き、前に選んだ幅は引き継がない', () => {
    const first = renderHook(usePlanningBoardGanttScale);
    expect(first.result.current.scale).toBe(1);
    act(() => first.result.current.changeScale(28));
    expect(first.result.current.scale).toBe(28);
    first.unmount();
    expect(renderHook(usePlanningBoardGanttScale).result.current.scale).toBe(1);
  });
  it('同じ幅をもう一度押しても今日へ戻す合図を出す', () => {
    const { result } = renderHook(usePlanningBoardGanttScale);
    const before = result.current.homeKey;
    act(() => result.current.changeScale(1));
    expect(result.current.scale).toBe(1);
    expect(result.current.homeKey).toBe(before + 1);
  });
  it('7日未満は日、それ以上は週で表記する', () => {
    expect([1, 2, 4, 7, 56].map((days) => ganttScaleLabel(days as 1 | 2 | 4 | 7 | 56))).toEqual(['1日', '2日', '4日', '1週', '8週']);
  });
});
