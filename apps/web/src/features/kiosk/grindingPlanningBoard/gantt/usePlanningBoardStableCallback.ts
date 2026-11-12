import { useCallback, useLayoutEffect, useRef } from 'react';

/** Memoized gantt rows get one fixed function that always calls the latest render's handler. */
export function usePlanningBoardStableCallback<Args extends unknown[], Result>(handler: (...args: Args) => Result) {
  const latest = useRef(handler);
  useLayoutEffect(() => { latest.current = handler; });
  return useCallback((...args: Args) => latest.current(...args), []);
}
