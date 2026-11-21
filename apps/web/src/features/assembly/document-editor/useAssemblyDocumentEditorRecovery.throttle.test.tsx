import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assemblyDocumentEditorRecoveryKey } from './assemblyDocumentEditorRecovery';
import { useAssemblyDocumentEditorRecovery } from './useAssemblyDocumentEditorRecovery';

const makeElements = (text: string) => [
  {
    id: 'overlay-1',
    pageIndex: 0,
    kind: 'TEXT' as const,
    text,
    bbox: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.1 },
    zIndex: 0
  }
];

const key = assemblyDocumentEditorRecoveryKey('doc-1');

describe('assembly document editor recovery write throttling', () => {
  let setItem: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    setItem = vi.spyOn(Storage.prototype, 'setItem');
  });
  afterEach(() => {
    setItem.mockRestore();
    vi.useRealTimers();
  });

  const render = (interacting: boolean, text: string) =>
    renderHook(
      (props: { interacting: boolean; text: string }) =>
        useAssemblyDocumentEditorRecovery({
          documentId: 'doc-1',
          baseUpdatedAt: null,
          editVersion: 1,
          elements: makeElements(props.text),
          enabled: true,
          dirty: true,
          interacting: props.interacting
        }),
      { initialProps: { interacting, text } }
    );
  const writes = () => setItem.mock.calls.filter(call => call[0] === key);
  const lastText = () => JSON.parse(String(writes().at(-1)?.[1])).elements[0].text;

  it('writes 750 ms after the last change when not interacting', () => {
    const { rerender } = render(false, 'a');
    act(() => { vi.advanceTimersByTime(700); });
    rerender({ interacting: false, text: 'b' });
    act(() => { vi.advanceTimersByTime(700); });
    expect(writes()).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(60); });
    expect(writes()).toHaveLength(1);
    expect(lastText()).toBe('b');
  });

  it('throttles to one write per 10 s while interacting and keeps the latest text', () => {
    const { rerender } = render(true, 't0');
    for (let i = 1; i <= 60; i += 1) {
      act(() => { vi.advanceTimersByTime(1000); });
      rerender({ interacting: true, text: `t${i}` });
    }
    expect(writes().length).toBeGreaterThanOrEqual(5);
    expect(writes().length).toBeLessThanOrEqual(7);
    // 最後の窓(50〜60秒)の書き込みは、その窓の中の最新の内容を含む
    expect(Number(lastText().slice(1))).toBeGreaterThanOrEqual(50);
  });

  it('writes the latest state promptly when interaction ends', () => {
    const { rerender } = render(true, 't0');
    act(() => { vi.advanceTimersByTime(3000); });
    rerender({ interacting: true, text: 'latest' });
    expect(writes()).toHaveLength(0);
    rerender({ interacting: false, text: 'latest' });
    act(() => { vi.advanceTimersByTime(750); });
    expect(writes()).toHaveLength(1);
    expect(lastText()).toBe('latest');
    act(() => { vi.advanceTimersByTime(20000); });
    expect(writes()).toHaveLength(1);
  });
});
