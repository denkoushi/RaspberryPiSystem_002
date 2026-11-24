import { useEffect, useRef } from 'react';

import type { DependencyList } from 'react';

/**
 * 選択中の行に付ける ref を返す。deps が変わったら、その行が隠れていれば見える位置へ送る。
 * 見えているときは動かさない（block: 'nearest'）。enabled が false の間は送らない。
 */
export function useScrollIntoViewOnChange<T extends HTMLElement>(deps: DependencyList, enabled = true) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (enabled) ref.current?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 送る時機は呼び出し側の deps で決める
  }, [enabled, ...deps]);
  return ref;
}
