import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IMAGE_MARKER_NUDGE_STEP_RATIO } from './imageMarkerPosition';
import { ImageMarkerPositionNudge } from './ImageMarkerPositionNudge';

describe('ImageMarkerPositionNudge', () => {
  it('renders accessible direction buttons in the inspection-compatible order', () => {
    render(
      <ImageMarkerPositionNudge
        position={{ xRatio: 0.5, yRatio: 0.5 }}
        groupLabel="締結マーカーの位置調整"
        onChange={vi.fn()}
      />
    );

    expect(screen.getByRole('group', { name: '締結マーカーの位置調整' })).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      '↑',
      '↓',
      '←',
      '→'
    ]);
    expect(screen.getByRole('button', { name: '上へ移動' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下へ移動' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '左へ移動' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '右へ移動' })).toBeInTheDocument();
  });

  it('emits a coordinate-only patch and supports disabled state', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ImageMarkerPositionNudge position={{ xRatio: 0.5, yRatio: 0.5 }} onChange={onChange} />
    );

    fireEvent.click(screen.getByRole('button', { name: '右へ移動' }));
    expect(onChange).toHaveBeenCalledWith({
      xRatio: 0.5 + IMAGE_MARKER_NUDGE_STEP_RATIO,
      yRatio: 0.5
    });

    rerender(
      <ImageMarkerPositionNudge
        position={{ xRatio: 0.5, yRatio: 0.5 }}
        disabled
        onChange={onChange}
      />
    );
    expect(screen.getAllByRole('button').every((button) => button.hasAttribute('disabled'))).toBe(true);
  });
});
