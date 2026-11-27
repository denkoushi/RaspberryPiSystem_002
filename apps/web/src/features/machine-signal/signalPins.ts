import { useStoredToggleSet } from '../../hooks/useStoredToggleSet';

const STORAGE_KEY = 'machine-signal-pins';

const pinOptions = {
  parse: (stored: unknown) => (Array.isArray(stored) ? stored.filter((value): value is number => Number.isInteger(value) && value > 0) : []),
  serialize: (values: readonly number[]) => values
};

export function useSignalPins(): { pins: ReadonlySet<number>; toggle: (signalNo: number) => void } {
  const { values, toggle } = useStoredToggleSet(STORAGE_KEY, pinOptions);
  return { pins: values, toggle };
}
