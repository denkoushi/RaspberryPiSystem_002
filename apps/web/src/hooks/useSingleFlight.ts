import { useCallback, useEffect, useRef, useState } from 'react';

/** Duplicate calls resolve undefined; accepted calls return fn's result or rethrow its error. */
export function useKeyedSingleFlight<Key>() {
  const inFlight = useRef(new Set<Key>());
  const mounted = useRef(true);
  const [pending, setPending] = useState<ReadonlySet<Key>>(new Set());
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = useCallback(async <Result,>(key: Key, fn: () => Result | Promise<Result>): Promise<Result | undefined> => {
    if (!mounted.current || inFlight.current.has(key)) return undefined;
    inFlight.current.add(key);
    setPending(new Set(inFlight.current));
    try {
      return await fn();
    } finally {
      inFlight.current.delete(key);
      if (mounted.current) setPending(new Set(inFlight.current));
    }
  }, []);
  const isPending = useCallback((key: Key) => pending.has(key), [pending]);
  return { run, isPending };
}

/** Synchronous single-flight guard, with the same result/error contract as the keyed variant. */
export function useSingleFlight() {
  const { run: runKeyed, isPending } = useKeyedSingleFlight<null>();
  const run = useCallback(<Result,>(fn: () => Result | Promise<Result>) => runKeyed(null, fn), [runKeyed]);
  return { run, pending: isPending(null) };
}
