import { expect, it } from 'vitest';

import { isVisibleByArrival } from '../../isVisibleByArrival';

const waiting = { arrived: true, waitingForPair: true, isCompleted: false };

it('hides arrived rows waiting for their pair only while filtering', () => {
  expect(isVisibleByArrival(waiting, true)).toBe(false);
  expect(isVisibleByArrival(waiting, false)).toBe(true);
});

it('keeps completed and special due rows visible while waiting', () => {
  expect(isVisibleByArrival({ ...waiting, isCompleted: true }, true)).toBe(true);
  for (const kind of ['overnight', 'today']) {
    expect(isVisibleByArrival({ ...waiting, specialDue: { kind } }, true)).toBe(true);
    expect(isVisibleByArrival({ ...waiting, pendingSpecialDue: { kind } }, true)).toBe(true);
    expect(isVisibleByArrival({ ...waiting, specialDue: { kind }, pendingSpecialDue: null }, true)).toBe(false);
  }
});

it('keeps the existing arrival behavior for rows without a pair', () => {
  expect(isVisibleByArrival({ isCompleted: false }, true)).toBe(true);
  expect(isVisibleByArrival({ isCompleted: false, arrived: true }, true)).toBe(true);
  expect(isVisibleByArrival({ isCompleted: false, arrived: false }, true)).toBe(false);
});
