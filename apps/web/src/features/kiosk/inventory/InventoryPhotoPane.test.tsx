import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InventoryLocationBlocks } from './InventoryLocationBlocks';
import { InventoryPhotoPane } from './InventoryPhotoPane';

vi.mock('../../../api/client', () => ({
  inventoryThumbnailUrl: (value: string) => `thumb:${value}`,
  api: { get: vi.fn(() => new Promise(() => undefined)) },
}));

const photos = [
  { id: 'p1', photoIndex: 1, photoUrl: '/a.jpg', originalFilename: 'a.jpg' },
  { id: 'p2', photoIndex: 2, photoUrl: '/b.jpg', originalFilename: 'b.jpg' },
];

describe('InventoryPhotoPane', () => {
  it('enlarges the photo within the pane on tap and returns on a second tap', () => {
    render(<InventoryPhotoPane photos={photos} />);
    const photo = screen.getByRole('button', { name: '写真を拡大' });
    expect(screen.getByRole('button', { name: '写真2を表示' })).toBeInTheDocument();

    fireEvent.click(photo);
    expect(screen.getByRole('button', { name: '写真を元の大きさに戻す' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: '写真2を表示' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '写真を元の大きさに戻す' }));
    expect(screen.getByRole('button', { name: '写真を拡大' })).toBeInTheDocument();
  });

  it('switches the large photo from the thumbnail strip', () => {
    render(<InventoryPhotoPane photos={photos} />);
    fireEvent.click(screen.getByRole('button', { name: '写真2を表示' }));
    expect(screen.getByAltText('b.jpg')).toHaveAttribute('src', 'thumb:/b.jpg');
  });
});

describe('InventoryLocationBlocks', () => {
  it('shows area, shelf and drawer as separate values', () => {
    render(<InventoryLocationBlocks compartment={{ area: '30007_KSJP-55', shelfNumber: 2, drawerNumber: 3 }} />);
    const location = screen.getByLabelText('保管場所');
    expect(within(location).getByText('30007_KSJP-55')).toBeInTheDocument();
    expect(within(location).getByText('棚').nextSibling).toHaveTextContent('2');
    expect(within(location).getByText('引出し').nextSibling).toHaveTextContent('3');
  });
});

it('renders a single photo without an enlargement button', () => {
  render(<InventoryPhotoPane photos={photos.slice(0, 1)} />);
  expect(screen.getByAltText('a.jpg')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
