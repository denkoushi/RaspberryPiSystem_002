import { useLayoutEffect, useMemo, useRef } from 'react';

/** Board/chip/minutes query payloads contain JSON values; retain their identity on equal ordered contents. */
export function usePlanningBoardQueryData<T>(incoming: T): T {
  const previous = useRef<{ data: T; json: string } | null>(null);
  const next = useMemo(() => {
    const json = JSON.stringify(incoming) ?? '';
    return previous.current?.json === json ? previous.current : { data: incoming, json };
  }, [incoming]);
  useLayoutEffect(() => { previous.current = next; }, [next]);
  return next.data;
}
