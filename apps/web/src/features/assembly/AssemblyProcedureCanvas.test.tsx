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

  it('keeps OK/NG state colors while outlining the current input target', () => {
    render(
      <AssemblyProcedureImageWithMarkers
        imageContent={<img alt="手順書" src="data:image/svg+xml," />}
        inputTargetBoltId="bolt-ng"
        bolts={[
          { id: 'bolt-pending', markerNo: 1, xRatio: 0.1, yRatio: 0.1, label: '未入力', status: 'pending' },
          { id: 'bolt-ok', markerNo: 2, xRatio: 0.2, yRatio: 0.2, label: 'OK', status: 'ok' },
          { id: 'bolt-ng', markerNo: 3, xRatio: 0.3, yRatio: 0.3, label: 'NG', status: 'ng' }
        ]}
      />
    );

    expect(screen.getByRole('button', { name: '未入力' })).toHaveClass('bg-white');
    expect(screen.getByRole('button', { name: 'OK' })).toHaveClass('bg-emerald-500');
    expect(screen.getByRole('button', { name: 'NG' })).toHaveClass('bg-red-600', 'outline-[3px]', 'outline-sky-400');
  });

  it('keeps the editor selection cyan independently from work input targeting', () => {
    render(
      <AssemblyProcedureImageWithMarkers
        imageContent={<img alt="手順書" src="data:image/svg+xml," />}
        selectedBoltId="bolt-1"
        bolts={[
          { id: 'bolt-1', markerNo: 1, xRatio: 0.1, yRatio: 0.1, label: '編集選択', status: 'ok' }
        ]}
      />
    );

    expect(screen.getByRole('button', { name: '編集選択' })).toHaveClass('bg-cyan-300');
    expect(screen.getByRole('button', { name: '編集選択' })).not.toHaveClass('outline-sky-400');
  });
});
