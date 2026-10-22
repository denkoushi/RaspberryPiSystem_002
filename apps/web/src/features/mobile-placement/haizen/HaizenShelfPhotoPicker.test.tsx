import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { HaizenShelfPhotoPicker } from './HaizenShelfPhotoPicker';

import type { RegisteredShelfEntryDto } from '../registeredShelves';

vi.mock('../../../api/client', () => ({ getMobilePlacementShelfPhoto: vi.fn() }));
const shelves: RegisteredShelfEntryDto[] = [
  { shelfCodeRaw: '西-北-01', isStructured: true, areaId: 'west', displayLabel: 'ロボドリル01 南 上段' },
  { shelfCodeRaw: '中央-北-01', isStructured: true, areaId: 'central' },
  { shelfCodeRaw: '東-南-02', isStructured: true, areaId: 'east' }
];
function mount(previousShelfCodes: string[] = []) {
  const props = { shelves, previousShelfCodes, selected: '', loading: false, error: false, onRetry: vi.fn(), onSelect: vi.fn(), onClose: vi.fn(), onScan: vi.fn(), onMaster: vi.fn() };
  render(<QueryClientProvider client={new QueryClient()}><HaizenShelfPhotoPicker {...props} /></QueryClientProvider>);
  return props;
}
describe('photo shelf picker', () => {
  it('filters previous shelves and areas, selects a shelf and shows no-photo placeholders', () => {
    const props = mount(['東-南-02']);
    expect(screen.getByText('前回')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '棚 西-北-01' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全部', exact: true }));
    expect(screen.getByLabelText('西-北-01 写真なし')).toBeInTheDocument();
    expect(screen.getByText('ロボドリル01 南 上段')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '西', exact: true }));
    expect(screen.queryByRole('button', { name: '棚 東-南-02' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '棚 西-北-01' }));
    expect(props.onSelect).toHaveBeenCalledWith('西-北-01');
    fireEvent.click(screen.getByRole('button', { name: '中央', exact: true }));
    expect(screen.getByRole('button', { name: '棚 中央-北-01' })).toBeInTheDocument();
  });
  it('offers all shelves by default and retains QR and back controls', () => {
    const props = mount();
    expect(screen.getByRole('button', { name: '全部', exact: true })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'QR' }));
    expect(props.onScan).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(props.onClose).toHaveBeenCalled();
  });
});
