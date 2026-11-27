import { useState } from 'react';

type StoredToggleSetOptions<T> = {
  /** 保存値(JSON.parse 済み)から要素を取り出す。形が違えば空配列を返す。 */
  parse: (stored: unknown) => readonly T[];
  /** 要素の配列を保存する形に変える。 */
  serialize: (values: readonly T[]) => unknown;
};

function readStoredSet<T>(storageKey: string, parse: StoredToggleSetOptions<T>['parse']): ReadonlySet<T> {
  try {
    return new Set(parse(JSON.parse(window.localStorage.getItem(storageKey) ?? 'null')));
  } catch {
    return new Set();
  }
}

/** localStorage に覚える「付け外しできる集合」。保存できない端末でも、この画面での付け外しは続けられる。 */
export function useStoredToggleSet<T>(storageKey: string, { parse, serialize }: StoredToggleSetOptions<T>): { values: ReadonlySet<T>; toggle: (value: T) => void } {
  const [values, setValues] = useState(() => readStoredSet(storageKey, parse));
  const toggle = (value: T) => {
    const next = new Set(values);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(serialize([...next])));
    } catch {
      // 保存できなくても、この画面での付け外しは続けられる。
    }
    setValues(next);
  };
  return { values, toggle };
}
