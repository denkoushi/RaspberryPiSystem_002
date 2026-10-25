import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlacementLocationBadge } from './PlacementLocationBadge';

const first = { shelfCodeRaw: 'A', label: '棚A', placedAt: '2026-10-24T06:20:00Z' };
const second = { shelfCodeRaw: 'B', label: '棚B', placedAt: '2020-10-23T01:10:00Z' };

describe('PlacementLocationBadge', () => {
  it('renders nothing for an empty placement', () => {
    const { container } = render(<PlacementLocationBadge placement={{ shelves: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a pin, shelf and Tokyo timestamp without fading old records', () => {
    render(<PlacementLocationBadge placement={{ shelves: [second] }} className="mt-0.5" />);
    const badge = screen.getByTitle('棚B 10/23 10:10');
    expect(badge).toHaveTextContent('棚B');
    expect(badge).toHaveClass('mt-0.5', 'border-sky-400/70', 'bg-sky-500/20', 'text-sky-100');
    expect(badge.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(badge.className).not.toContain('opacity');
    expect(document.querySelector('details')).toBeNull();
  });

  it('opens and closes every shelf in a portal without selecting or dragging its parent', async () => {
    const onClick = vi.fn();
    const onPointerDown = vi.fn();
    render(<div onClick={onClick} onPointerDown={onPointerDown}>
      <PlacementLocationBadge placement={{ shelves: [first, second] }} />
    </div>);
    const summary = screen.getByText('+1').closest('summary')!;
    expect(summary).toHaveTextContent('棚A+1');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.pointerDown(summary);
    fireEvent.click(summary);
    const panel = await screen.findByRole('dialog');
    expect(panel.parentElement).toBe(document.body);
    expect(within(panel).getByText('棚A')).toBeInTheDocument();
    expect(within(panel).getByText('棚B')).toBeInTheDocument();
    expect(within(panel).getByText('10/24 15:20')).toBeInTheDocument();
    expect(within(panel).getByText('10/23 10:10')).toBeInTheDocument();
    fireEvent.pointerDown(within(panel).getByText('棚B'));
    fireEvent.click(within(panel).getByText('棚B'));
    expect(onClick).not.toHaveBeenCalled();
    expect(onPointerDown).not.toHaveBeenCalled();
    fireEvent.click(summary);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
