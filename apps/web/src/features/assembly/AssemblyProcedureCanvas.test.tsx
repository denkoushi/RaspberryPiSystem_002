import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AssemblyProcedureImageWithMarkers,
  AssemblyProcedureMarkerLayer
} from './AssemblyProcedureCanvas';

describe('AssemblyProcedureImageWithMarkers', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the rendered work-view image size as the callout SVG coordinate space', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 900,
      height: 620,
      top: 0,
      right: 900,
      bottom: 620,
      left: 0,
      toJSON: () => ({})
    });

    render(
      <AssemblyProcedureImageWithMarkers
        fitToParent
        imageContent={<img alt="手順書" src="data:image/svg+xml," />}
        bolts={[
          {
            id: 'bolt-1',
            markerNo: 1,
            xRatio: 0.3,
            yRatio: 0.4,
            calloutTipXRatio: 0.8,
            calloutTipYRatio: 0.2,
            label: '締結1'
          }
        ]}
      />
    );

    expect(await screen.findByTestId('image-marker-callout-svg')).toHaveAttribute(
      'viewBox',
      '0 0 900 620'
    );
  });

  it('renders marker numbers and callouts through the shared normal and compact layers', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      top: 0,
      right: 200,
      bottom: 100,
      left: 0,
      toJSON: () => ({})
    });

    const marker = {
      id: 'shared-bolt',
      markerNo: 7,
      xRatio: 0.5,
      yRatio: 0.5,
      calloutTipXRatio: 1,
      calloutTipYRatio: 0.5,
      label: '共通丸数字7'
    };
    const { rerender } = render(
      <div className="relative h-[100px] w-[200px]">
        <AssemblyProcedureMarkerLayer bolts={[marker]} />
      </div>
    );

    expect(await screen.findByRole('button', { name: '共通丸数字7' })).toHaveStyle({
      left: '50%',
      top: '50%'
    });
    expect(screen.getByTestId('image-marker-callout-svg')).toBeInTheDocument();

    rerender(
      <div className="relative h-[100px] w-[200px]">
        <AssemblyProcedureMarkerLayer bolts={[marker]} density="compact" />
      </div>
    );
    expect(screen.queryByRole('button', { name: '共通丸数字7' })).not.toBeInTheDocument();
    expect(document.querySelector('[data-marker-id="shared-bolt"]')).toHaveTextContent('7');
    expect(screen.getByTestId('image-marker-callout-svg')).toBeInTheDocument();
  });
});
