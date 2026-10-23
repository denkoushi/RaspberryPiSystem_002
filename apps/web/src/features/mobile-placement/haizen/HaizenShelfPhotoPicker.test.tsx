import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { HaizenShelfPhotoList, HaizenShelfPhotoPicker } from './HaizenShelfPhotoPicker';

import type { RegisteredShelfEntryDto } from '../registeredShelves';

vi.mock('../shelfPhoto/useShelfPhoto', () => ({ useShelfPhoto: (_code: string, updatedAt?: string) => ({ url: updatedAt ? '/shelf-photo.jpg' : undefined }) }));
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
  it.each([false, true])('second tap enlarges the selected shelf (compact: %s)', (compact) => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    function Harness() {
      const [selected, setSelected] = useState('');
      const props = { shelves, previousShelfCodes: [], selected, loading: false, error: false, onRetry: vi.fn(),
        onSelect: (code: string) => { onSelect(code); setSelected(code); } };
      return compact ? <HaizenShelfPhotoList {...props} compact />
        : <HaizenShelfPhotoPicker {...props} onClose={onClose} onScan={vi.fn()} onMaster={vi.fn()} />;
    }
    render(<QueryClientProvider client={new QueryClient()}><Harness /></QueryClientProvider>);
    const tile = screen.getByRole('button', { name: '棚 西-北-01' });
    expect(screen.queryByText('もう一度で拡大')).not.toBeInTheDocument();
    fireEvent.click(tile);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('西-北-01');
    expect(tile).toHaveAttribute('aria-pressed', 'true');
    expect(within(tile).getByText('もう一度で拡大')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '棚の写真を拡大' })).not.toBeInTheDocument();
    fireEvent.click(tile);
    const viewer = screen.getByRole('dialog', { name: '棚の写真を拡大' });
    expect(viewer).toHaveStyle({ zIndex: 70 });
    expect(within(viewer).getByLabelText('西-北-01 写真なし')).toBeInTheDocument();
    expect(within(viewer).getByText('ロボドリル01 南 上段')).toBeInTheDocument();
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.click(within(viewer).getByRole('button', { name: '閉じる', exact: true }));
    expect(screen.queryByRole('dialog', { name: '棚の写真を拡大' })).not.toBeInTheDocument();
    expect(tile).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(tile);
    fireEvent.click(screen.getByRole('button', { name: '写真を閉じる' }));
    expect(screen.queryByRole('dialog', { name: '棚の写真を拡大' })).not.toBeInTheDocument();
    fireEvent.click(tile);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '棚の写真を拡大' })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    if (!compact) expect(screen.getByRole('dialog', { name: '棚を選ぶ' })).toBeInTheDocument();
  });

  it('keeps thumbnails cropped and contains the full photo in the viewer', () => {
    render(<HaizenShelfPhotoPicker shelves={[{ ...shelves[0], photoUpdatedAt: '2026-10-23' }]} previousShelfCodes={[]}
      selected={shelves[0].shelfCodeRaw} loading={false} error={false} onRetry={vi.fn()} onSelect={vi.fn()}
      onClose={vi.fn()} onScan={vi.fn()} onMaster={vi.fn()} />);
    const picker = screen.getByRole('dialog', { name: '棚を選ぶ' });
    expect(within(picker).getByRole('img')).toHaveClass('object-cover');
    fireEvent.click(within(picker).getByRole('button', { name: '棚 西-北-01' }));
    const viewer = screen.getByRole('dialog', { name: '棚の写真を拡大' });
    expect(within(viewer).getByRole('img')).toHaveClass('object-contain');
    fireEvent.click(within(viewer).getByRole('img'));
    expect(screen.queryByRole('dialog', { name: '棚の写真を拡大' })).not.toBeInTheDocument();
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
