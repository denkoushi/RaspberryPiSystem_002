import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureImageWithMarkers } from './AssemblyProcedureCanvas';

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

  it('keeps marker numbers accessible while distinguishing waiting, retry, and unaccepted states', () => {
    render(
      <AssemblyProcedureImageWithMarkers
        imageContent={<img alt="手順書" src="data:image/svg+xml," />}
        showTorqueLegend
        bolts={[
          { id: 'waiting', markerNo: 11, xRatio: 0.2, yRatio: 0.2, label: '締結11', status: 'waiting' },
          { id: 'retry', markerNo: 12, xRatio: 0.4, yRatio: 0.4, label: '締結12', status: 'retry' },
          { id: 'unaccepted', markerNo: 13, xRatio: 0.6, yRatio: 0.6, label: '締結13', status: 'unaccepted' }
        ]}
      />
    );

    expect(screen.getByRole('button', { name: '締結11、入力待ち' })).toHaveTextContent('11');
    expect(screen.getByRole('button', { name: '締結12、NG・再入力' })).toHaveTextContent('×');
    expect(screen.getByRole('button', { name: '締結13、未受付' })).toHaveTextContent('×');
    expect(screen.getByLabelText('丸数字の状態凡例')).toBeInTheDocument();
  });
});
