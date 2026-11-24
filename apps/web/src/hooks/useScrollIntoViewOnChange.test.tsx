import { render } from '@testing-library/react';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { useScrollIntoViewOnChange } from './useScrollIntoViewOnChange';

function Row({ selected, enabled }: { selected: string; enabled?: boolean }) {
  const ref = useScrollIntoViewOnChange<HTMLDivElement>([selected], enabled);
  return <div ref={ref} data-testid="row" />;
}

describe('useScrollIntoViewOnChange', () => {
  it('scrolls the element nearest into view on mount and when deps change, and not when disabled', () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    onTestFinished(() => { Element.prototype.scrollIntoView = original; });

    const { rerender, getByTestId } = render(<Row selected="a" />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
    expect(scrollIntoView.mock.contexts[0]).toBe(getByTestId('row'));

    rerender(<Row selected="a" />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    rerender(<Row selected="b" />);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    rerender(<Row selected="c" enabled={false} />);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
});
