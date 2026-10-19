import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MaterialArrivalBadge } from '../../../../components/kiosk/MaterialArrivalBadge';

import type { MaterialArrivalStatus } from '@raspi-system/shared-types';

describe('MaterialArrivalBadge', () => {
  it.each([
    ['received', '入荷済'], ['partial', '一部入荷済'], ['ordered', '未入荷'], ['unordered', '未発注']
  ] as const)('switches the wording while keeping the same presentation (%s)', (status, label) => {
    const { rerender } = render(<MaterialArrivalBadge status={status} />);
    const material = screen.getByText(`材料${label}`);
    const className = material.className;
    rerender(<MaterialArrivalBadge status={status} basis="part" />);
    expect(screen.getByText(`部品${label}`).className).toBe(className);
    rerender(<MaterialArrivalBadge status={status} basis="material" />);
    expect(screen.getByText(`材料${label}`)).toBeInTheDocument();
  });

  it.each([null, undefined, 'future-status', 'toString'])('renders nothing for absent or unknown status (%s)', (status) => {
    const { container } = render(<MaterialArrivalBadge status={status as MaterialArrivalStatus | null | undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
