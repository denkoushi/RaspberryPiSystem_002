import { useState } from 'react';

const STORAGE_KEY = 'machine-signal-pins';

function readPins(): ReadonlySet<number> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return new Set(Array.isArray(stored) ? stored.filter((value): value is number => Number.isInteger(value) && value > 0) : []);
  } catch {
    return new Set();
  }
}

export function useSignalPins(): { pins: ReadonlySet<number>; toggle: (signalNo: number) => void } {
  const [pins, setPins] = useState(readPins);
  const toggle = (signalNo: number) => {
    const next = new Set(pins);
    if (next.has(signalNo)) next.delete(signalNo);
    else next.add(signalNo);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      // 保存できなくても、この画面での付け外しは続けられる。
    }
    setPins(next);
  };
  return { pins, toggle };
}
