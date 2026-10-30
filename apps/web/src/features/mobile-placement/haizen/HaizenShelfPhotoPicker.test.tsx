import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HaizenShelfPhotoList, HaizenShelfPhotoPicker } from './HaizenShelfPhotoPicker';

import type { RegisteredShelfEntryDto } from '../registeredShelves';

vi.mock('../shelfPhoto/useShelfPhoto', () => ({ useShelfPhoto: (_code: string, updatedAt?: string) => ({ url: updatedAt ? '/shelf-photo.jpg' : undefined }) }));
const shelves: RegisteredShelfEntryDto[] = [
  { shelfCodeRaw: 'DAD-3220 北', isStructured: true, machineName: 'DAD-3220', direction: '北', displayLabel: 'ロボドリル01 南 上段' },
  { shelfCodeRaw: '50013_540AP 西', isStructured: true, machineName: '50013_540AP', direction: '西' },
  { shelfCodeRaw: 'DAD-3220 南', isStructured: true, machineName: 'DAD-3220', direction: '南' },
  { shelfCodeRaw: '東-南-02', isStructured: true, areaId: 'east' }
];
function mount(previousShelfCodes: string[] = [], selected = '') {
  const props = { shelves, previousShelfCodes, selected, loading: false, error: false, onRetry: vi.fn(), onSelect: vi.fn(), onClose: vi.fn(), onScan: vi.fn(), onMaster: vi.fn() };
  render(<QueryClientProvider client={new QueryClient()}><HaizenShelfPhotoPicker {...props} /></QueryClientProvider>);
  return props;
}
describe('photo shelf picker', () => {
  it('groups and filters previous shelves and machines, selects a shelf and shows no-photo placeholders', () => {
    const props = mount(['東-南-02']);
    expect(screen.getByRole('button', { name: '前回', exact: true })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '棚 DAD-3220 北 ロボドリル01 南 上段' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全部', exact: true }));
    expect(screen.getByLabelText('北 写真なし')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'DAD-3220 2棚' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'その他 1棚' })).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: '棚 DAD-3220 北 ロボドリル01 南 上段' })).getByText('北', { selector: 'b' })).toBeInTheDocument();
    expect(screen.queryByText('東-南-02')).not.toBeInTheDocument();
    expect(screen.getByText('ロボドリル01 南 上段')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'DAD-3220', exact: true }));
    expect(screen.queryByRole('button', { name: '棚 写真' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '棚 DAD-3220 北 ロボドリル01 南 上段' }));
    expect(props.onSelect).toHaveBeenCalledWith('DAD-3220 北');
    fireEvent.click(screen.getByRole('button', { name: '50013_540AP', exact: true }));
    expect(screen.getByRole('button', { name: '棚 50013_540AP 西' })).toBeInTheDocument();
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
    const tile = screen.getByRole('button', { name: '棚 DAD-3220 北 ロボドリル01 南 上段' });
    expect(screen.queryByText('もう一度で拡大')).not.toBeInTheDocument();
    fireEvent.click(tile);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('DAD-3220 北');
    expect(tile).toHaveAttribute('aria-pressed', 'true');
    expect(within(tile).queryByText('もう一度で拡大')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '棚の写真を拡大' })).not.toBeInTheDocument();
    fireEvent.click(tile);
    const viewer = screen.getByRole('dialog', { name: '棚の写真を拡大' });
    expect(viewer).toHaveStyle({ zIndex: 70 });
    expect(within(viewer).getByLabelText('北 写真なし')).toBeInTheDocument();
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

  it.each([false, true])('compact shows every machine and places tools below the grid (disabled: %s)', (disabled) => {
    const onExpand = vi.fn();
    render(<HaizenShelfPhotoList shelves={shelves} previousShelfCodes={['DAD-3220 北']} selected="DAD-3220 北"
      loading={false} error={false} onRetry={vi.fn()} onSelect={vi.fn()} compact disabled={disabled} onExpand={onExpand} />);
    for (const name of ['全部', '前回']) {
      expect(screen.queryByRole('button', { name, exact: true })).not.toBeInTheDocument();
    }
    expect(screen.getAllByRole('button', { name: /^棚 / })).toHaveLength(shelves.length);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'DAD-3220', exact: true })).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: '棚 DAD-3220 北 ロボドリル01 南 上段' })).getByText('前回')).toBeInTheDocument();
    const expand = screen.getByRole('button', { name: '大きい画面で選ぶ' });
    expect(expand).toHaveClass('!h-12', '!w-12');
    expect(expand).not.toHaveClass('absolute');
    fireEvent.click(expand);
    expect(onExpand).toHaveBeenCalledTimes(disabled ? 0 : 1);
  });

  it('keeps thumbnails cropped and contains the full photo in the viewer', () => {
    render(<HaizenShelfPhotoPicker shelves={[{ ...shelves[0], photoUpdatedAt: '2026-10-23' }]} previousShelfCodes={[]}
      selected={shelves[0].shelfCodeRaw} loading={false} error={false} onRetry={vi.fn()} onSelect={vi.fn()}
      onClose={vi.fn()} onScan={vi.fn()} onMaster={vi.fn()} />);
    const picker = screen.getByRole('dialog', { name: '棚を選ぶ' });
    expect(within(picker).getByRole('img')).toHaveClass('object-cover');
    fireEvent.click(within(picker).getByRole('button', { name: '棚 DAD-3220 北 ロボドリル01 南 上段' }));
    const viewer = screen.getByRole('dialog', { name: '棚の写真を拡大' });
    expect(within(viewer).getByRole('img')).toHaveClass('object-contain');
    fireEvent.click(within(viewer).getByRole('img'));
    expect(screen.queryByRole('dialog', { name: '棚の写真を拡大' })).not.toBeInTheDocument();
  });

  it.each(['北西', '北東', '南西', '南東', undefined] as const)('groups landmark shelves with direction %s and opens their photo', (direction) => {
    const shelf: RegisteredShelfEntryDto = { shelfCodeRaw: direction ? `電気室 ${direction}` : '電気室', machineName: '電気室', direction, isStructured: true };
    render(<HaizenShelfPhotoPicker shelves={[shelf, ...shelves]} previousShelfCodes={[]} selected={shelf.shelfCodeRaw}
      loading={false} error={false} onRetry={vi.fn()} onSelect={vi.fn()} onClose={vi.fn()} onScan={vi.fn()} onMaster={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '電気室', exact: true }));
    expect(screen.getByRole('heading', { name: '電気室 1棚' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'DAD-3220 2棚' })).not.toBeInTheDocument();
    const tile = screen.getByRole('button', { name: `棚 電気室${direction ? ` ${direction}` : ''}`, exact: true });
    expect(tile.querySelector('b')?.textContent).toBe(direction);
    fireEvent.click(tile);
    const viewer = screen.getByRole('dialog', { name: '棚の写真を拡大' });
    expect(within(viewer).getByText(shelf.shelfCodeRaw)).toBeInTheDocument();
  });

  it.each(['', '東-南-02', 'DAD-3220 北'])('keeps the selected shelf visible on opening: %s', (selected) => {
    mount(['東-南-02'], selected);
    expect(screen.getByRole('button', { name: selected === 'DAD-3220 北' ? '全部' : '前回', exact: true })).toHaveAttribute('aria-pressed', 'true');
    if (selected) expect(screen.getByRole('button', { name: /^棚 /, pressed: true })).toBeInTheDocument();
  });

  it('scrolls the grid so a selected shelf below the fold is visible', () => {
    const rect = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}) });
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('aria-pressed') === 'true' ? rect(500, 100) : rect(100, 300);
    });
    render(<HaizenShelfPhotoList shelves={shelves} previousShelfCodes={[]} selected="50013_540AP 西"
      loading={false} error={false} onRetry={vi.fn()} onSelect={vi.fn()} compact />);
    expect(screen.getByRole('button', { name: /^棚 50013_540AP 西/, pressed: true }).closest('[class*="overflow-y-auto"]')!.scrollTop).toBe(392);
    spy.mockRestore();
  });
  it.each([false, true])('overlays direction on the photo and retains the separate display label (compact: %s)', (compact) => {
    render(<HaizenShelfPhotoList shelves={[{ ...shelves[0], photoUpdatedAt: 'now' }, shelves[3]]} previousShelfCodes={[]} selected=""
      loading={false} error={false} onRetry={vi.fn()} onSelect={vi.fn()} compact={compact} />);
    const tile = screen.getByRole('button', { name: '棚 DAD-3220 北 ロボドリル01 南 上段' });
    if (compact) {
      expect(within(tile).getByText('北 ロボドリル01 南 上段', { selector: 'b' })).toHaveClass('text-xl', 'font-black');
      expect(within(tile).getByText('DAD-3220')).toHaveClass('font-mono', 'text-xs');
      expect(tile).toHaveClass('border-[3px]');
      return;
    }
    const direction = within(tile).getByText('北', { selector: 'b' });
    const overlay = direction.parentElement;
    const photo = within(tile).getByRole('img');
    expect(photo.parentElement).toHaveClass('relative');
    expect(overlay?.parentElement).toBe(photo.parentElement);
    expect(overlay).toHaveClass('absolute', 'inset-x-0', 'bottom-0', 'bg-[linear-gradient(to_bottom,transparent,rgba(0,0,0,0.78))]');
    expect(direction).toHaveClass('font-mono', 'truncate', 'text-[var(--hp-shelf)]', compact ? 'text-sm' : 'text-lg');
    expect(tile.querySelectorAll('b')).toHaveLength(1);
    const label = within(tile).getByText('ロボドリル01 南 上段');
    expect(photo.parentElement).not.toContainElement(label);
    expect(label.parentElement?.querySelector('b')).toBeNull();
    expect(screen.getByRole('button', { name: '棚 写真' }).querySelector('.absolute')).toBeNull();
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

describe.each([false, true])('shelf speech selection (compact: %s)', (compact) => {
  function mountSpeech(previousShelfCodes: string[] = [], disabled = false) {
    const native = {
      isAvailable: () => true, scanFseiban: vi.fn(), isSpeechAvailable: () => true,
      startSpeech: vi.fn(), stopSpeech: vi.fn(() => window.__haizenNativeSpeechResult?.({ status: 'cancelled' }))
    };
    window.HaizenNative = native;
    const onSelect = vi.fn();
    function Harness({ entries }: { entries: RegisteredShelfEntryDto[] }) {
      const [selected, setSelected] = useState('');
      const props = { shelves: entries, previousShelfCodes, selected, loading: false, error: false, onRetry: vi.fn(),
        onSelect: (code: string) => { onSelect(code); setSelected(code); } };
      return compact ? <HaizenShelfPhotoList {...props} compact disabled={disabled} onExpand={vi.fn()} />
        : <HaizenShelfPhotoPicker {...props} onClose={vi.fn()} onScan={vi.fn()} onMaster={vi.fn()} />;
    }
    const view = render(<Harness entries={shelves} />);
    return { ...view, native, onSelect, replaceShelves: (entries: RegisteredShelfEntryDto[]) => view.rerender(<Harness entries={entries} />) };
  }
  const mic = () => screen.getByRole('button', { name: '声で棚を選ぶ' });
  const tiles = () => screen.getAllByRole('button', { name: /^棚 / });
  async function speak(texts: string[]) {
    fireEvent.click(mic());
    expect(mic()).toHaveAttribute('aria-pressed', 'true');
    await act(async () => window.__haizenNativeSpeechResult?.({ status: 'ok', texts }));
    expect(mic()).toHaveAttribute('aria-pressed', 'false');
  }
  afterEach(async () => {
    await act(async () => window.__haizenNativeSpeechResult?.({ status: 'cancelled' }));
    delete window.HaizenNative;
  });

  it('selects a single match from recognition alternatives and scrolls it into view', async () => {
    const rect = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}) });
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('aria-pressed') === 'true' ? rect(500, 100) : rect(100, 300);
    });
    try {
      const { onSelect } = mountSpeech(['東-南-02']);
      await speak(['さくら', '3220 北']);
      expect(onSelect).toHaveBeenCalledExactlyOnceWith('DAD-3220 北');
      const selected = screen.getByRole('button', { name: /^棚 DAD-3220 北/, pressed: true });
      expect(selected.closest('[class*="overflow-y-auto"]')!.scrollTop).toBe(392);
      expect(screen.queryByRole('dialog', { name: '棚の写真を拡大' })).not.toBeInTheDocument();
    } finally { spy.mockRestore(); }
  });
  it('filters multiple matches, shows the spoken chip and restores tiles with ×', async () => {
    const { onSelect } = mountSpeech();
    await speak(['3220', '50013']);
    expect(tiles()).toHaveLength(2);
    expect(onSelect).not.toHaveBeenCalled();
    const chip = screen.getByRole('button', { name: '3220 の絞り込みを解除' });
    expect(chip).toHaveTextContent('3220 ×');
    fireEvent.click(chip);
    expect(tiles()).toHaveLength(shelves.length);
  });
  it('clears the speech filter when a shelf is tapped', async () => {
    const { onSelect } = mountSpeech();
    await speak(['3220']);
    fireEvent.click(screen.getByRole('button', { name: /^棚 DAD-3220 北/ }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('DAD-3220 北');
    expect(tiles()).toHaveLength(shelves.length);
    expect(screen.queryByRole('button', { name: /絞り込みを解除/ })).not.toBeInTheDocument();
  });
  it('clears the speech filter on the next mic tap and stops on another tap', async () => {
    const { native } = mountSpeech();
    await speak(['3220']);
    fireEvent.click(mic());
    expect(tiles()).toHaveLength(shelves.length);
    expect(screen.queryByRole('button', { name: /絞り込みを解除/ })).not.toBeInTheDocument();
    fireEvent.click(mic());
    await waitFor(() => expect(mic()).toHaveAttribute('aria-pressed', 'false'));
    expect(native.startSpeech).toHaveBeenCalledTimes(2);
    expect(native.stopSpeech).toHaveBeenCalledTimes(1);
  });
  it('clears the speech filter when shelves change', async () => {
    const { replaceShelves } = mountSpeech();
    await speak(['3220']);
    replaceShelves([shelves[1], shelves[3]]);
    expect(tiles()).toHaveLength(2);
    expect(screen.getByRole('button', { name: '棚 50013_540AP 西' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /絞り込みを解除/ })).not.toBeInTheDocument();
  });
  if (!compact) it('shows all voice matches across filters and keeps machine chips usable', async () => {
    mountSpeech(['東-南-02']);
    await speak(['3220']);
    expect(tiles()).toHaveLength(2);
    expect(screen.getByRole('button', { name: '全部', exact: true })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '50013_540AP', exact: true }));
    expect(tiles()).toHaveLength(1);
    expect(screen.getByRole('button', { name: '棚 50013_540AP 西' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /絞り込みを解除/ })).not.toBeInTheDocument();
  });
  it('matches the latest shelves when they change during recognition', async () => {
    const { onSelect, replaceShelves } = mountSpeech();
    fireEvent.click(mic());
    replaceShelves([shelves[1]]);
    await act(async () => window.__haizenNativeSpeechResult?.({ status: 'ok', texts: ['3220 北', '50013'] }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('50013_540AP 西');
  });
  it.each(['前回', 'ぜんかい', 'ゼンカイ'])('selects the first previous shelf for %s', async (text) => {
    const { onSelect } = mountSpeech(['50013_540AP 西', 'DAD-3220 北']);
    await speak([text]);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('50013_540AP 西');
  });
  it.each(['さくら', '前回'])('leaves shelves and selection unchanged for %s without a match', async (text) => {
    const { onSelect } = mountSpeech();
    await speak([text]);
    expect(onSelect).not.toHaveBeenCalled();
    expect(tiles()).toHaveLength(shelves.length);
    expect(screen.queryByRole('button', { name: /絞り込みを解除/ })).not.toBeInTheDocument();
  });
  it('silently handles cancellation and recognition failure', async () => {
    const { native, onSelect } = mountSpeech();
    fireEvent.click(mic());
    await act(async () => window.__haizenNativeSpeechResult?.({ status: 'cancelled' }));
    native.startSpeech.mockImplementationOnce(() => { throw new Error('unavailable'); });
    fireEvent.click(mic());
    await waitFor(() => expect(mic()).toHaveAttribute('aria-pressed', 'false'));
    expect(onSelect).not.toHaveBeenCalled();
    expect(tiles()).toHaveLength(shelves.length);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('stops recognition on unmount and ignores late results', async () => {
    const { native, unmount, onSelect } = mountSpeech();
    fireEvent.click(mic());
    const result = window.__haizenNativeSpeechResult;
    unmount();
    expect(native.stopSpeech).toHaveBeenCalledTimes(1);
    await act(async () => result?.({ status: 'ok', texts: ['3220 北'] }));
    expect(onSelect).not.toHaveBeenCalled();
  });
  it('positions and sizes the microphone beside the existing control', () => {
    mountSpeech();
    expect(mic()).toHaveClass('h-10', 'w-10', 'aria-pressed:bg-[var(--hp-shelf)]', 'aria-pressed:text-[var(--hp-bg)]');
    if (compact) {
      expect(mic()).toHaveClass('!h-12', '!w-12');
      expect(mic()).not.toHaveClass('absolute');
    } else expect(mic().nextElementSibling).toBe(screen.getByRole('button', { name: 'QR' }));
  });
  it('hides the microphone when isSpeechAvailable is missing', () => {
    window.HaizenNative = { isAvailable: () => true, scanFseiban: vi.fn(), startSpeech: vi.fn(), stopSpeech: vi.fn() };
    const props = { shelves, previousShelfCodes: [], selected: '', loading: false, error: false, onRetry: vi.fn(), onSelect: vi.fn() };
    render(compact ? <HaizenShelfPhotoList {...props} compact onExpand={vi.fn()} />
      : <HaizenShelfPhotoPicker {...props} onClose={vi.fn()} onScan={vi.fn()} onMaster={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '声で棚を選ぶ' })).not.toBeInTheDocument();
  });
  if (compact) it('stops listening when the list becomes disabled', async () => {
    const { native } = mountSpeech();
    const props = { shelves, previousShelfCodes: [], selected: '', loading: false, error: false, onRetry: vi.fn(), onSelect: vi.fn() };
    const { rerender } = render(<HaizenShelfPhotoList {...props} compact onExpand={vi.fn()} />);
    const ownMic = screen.getAllByRole('button', { name: '声で棚を選ぶ' })[1];
    fireEvent.click(ownMic);
    await act(async () => { rerender(<HaizenShelfPhotoList {...props} compact disabled onExpand={vi.fn()} />); });
    expect(native.stopSpeech).toHaveBeenCalledTimes(1);
    expect(ownMic).toHaveAttribute('aria-pressed', 'false');
  });
  if (compact) it('stops the compact list session when the full-screen picker opens', async () => {
    const { native } = mountSpeech();
    fireEvent.click(mic());
    await act(async () => { render(<HaizenShelfPhotoPicker shelves={shelves} previousShelfCodes={[]} selected="" loading={false} error={false} onRetry={vi.fn()} onSelect={vi.fn()} onClose={vi.fn()} onScan={vi.fn()} onMaster={vi.fn()} />); });
    expect(native.stopSpeech).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button', { name: '声で棚を選ぶ' })[0]).toHaveAttribute('aria-pressed', 'false');
  });
  if (compact) it('disables the microphone with the list', () => {
    const { native } = mountSpeech([], true);
    expect(mic()).toBeDisabled();
    fireEvent.click(mic());
    expect(native.startSpeech).not.toHaveBeenCalled();
  });
});

it('compact machine chips scroll to the first tile without filtering shelves', () => {
  const scrollTo = vi.fn();
  render(<HaizenShelfPhotoList shelves={shelves} previousShelfCodes={[]} selected="" loading={false} error={false} onRetry={vi.fn()} onSelect={vi.fn()} compact />);
  const tile = screen.getByRole('button', { name: '棚 50013_540AP 西' });
  const grid = tile.parentElement!;
  grid.scrollTo = scrollTo;
  vi.spyOn(tile, 'getBoundingClientRect').mockReturnValue({ top: 220 } as DOMRect);
  vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({ top: 20 } as DOMRect);
  fireEvent.click(screen.getByRole('button', { name: '50013_540AP', exact: true }));
  expect(scrollTo).toHaveBeenCalledWith({ top: 200, behavior: 'auto' });
  expect(screen.getAllByRole('button', { name: /^棚 / })).toHaveLength(shelves.length);
});
