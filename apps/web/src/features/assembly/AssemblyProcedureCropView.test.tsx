import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureCropView } from './AssemblyProcedureCropView';

describe('AssemblyProcedureCropView', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports crop-local placement coordinates from the rendered crop frame', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      width: 400,
      height: 200,
      top: 20,
      right: 410,
      bottom: 220,
      left: 10,
      toJSON: () => ({})
    });
    const onPlacementClick = vi.fn();

    render(
      <div className="h-[200px] w-[400px]">
        <AssemblyProcedureCropView
          pageUrl="/api/page.png"
          crop={{ xRatio: 0.2, yRatio: 0.2, widthRatio: 0.4, heightRatio: 0.4 }}
          onPlacementClick={onPlacementClick}
        />
      </div>
    );

    fireEvent.click(screen.getByTestId('assembly-procedure-crop-view'), {
      clientX: 310,
      clientY: 70
    });
    expect(onPlacementClick).toHaveBeenCalledWith(0.75, 0.25);
  });
});
