import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ImageMarkerCalloutOverlay } from './ImageMarkerCalloutOverlay';

describe('ImageMarkerCalloutOverlay', () => {
  it('draws paired bolt/check callouts and ignores incomplete pairs', () => {
    const { container } = render(
      <div className="relative h-[200px] w-[200px]">
        <ImageMarkerCalloutOverlay
          items={[
            { id: 'bolt-1', markerNo: 1, xRatio: 0.2, yRatio: 0.2, calloutTipXRatio: 0.8, calloutTipYRatio: 0.2 },
            { id: 'check-2', markerNo: 2, xRatio: 0.3, yRatio: 0.3, calloutTipXRatio: 0.7, calloutTipYRatio: 0.7, tone: 'lime' },
            { id: 'invalid', markerNo: 3, xRatio: 0.5, yRatio: 0.5, calloutTipXRatio: 0.5, calloutTipYRatio: null }
          ]}
          selectedId="bolt-1"
          image={{ offsetX: 0, offsetY: 0, width: 100, height: 100 }}
          contentWidth={100}
          contentHeight={100}
        />
      </div>
    );
    expect(container.querySelectorAll('line')).toHaveLength(2);
    expect(container.textContent).toContain('1');
    expect(container.textContent).toContain('2');
    expect(container.textContent).not.toContain('3');
  });
});
