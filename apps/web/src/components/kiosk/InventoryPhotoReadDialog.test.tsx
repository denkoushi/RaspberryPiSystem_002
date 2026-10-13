import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readInventoryPhotoRegion, type InventoryOptionField } from '../../api/client';

import { InventoryPhotoReadDialog } from './InventoryPhotoReadDialog';

vi.mock('../../api/client', () => ({ readInventoryPhotoRegion: vi.fn() }));
vi.mock('./useInventoryFullPhoto', () => ({ useInventoryFullPhoto: (url: string) => ({ imageUrl: url, error: false }) }));
const photos = [{ id: 'p1', photoUrl: '/1.jpg', alt: '写真1' }, { id: 'p2', photoUrl: '/2.jpg', alt: '写真2' }];
const bbox = { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.4, heightRatio: 0.3 };
const storageKey = 'kiosk-inventory-ocr-frames';

function Harness({ single = false, onApply = vi.fn() }: { single?: boolean; onApply?: (field: InventoryOptionField, value: string) => void }) {
  const [values, setValues] = useState<Partial<Record<InventoryOptionField, string>>>({});
  return <InventoryPhotoReadDialog photos={single ? photos.slice(0, 1) : photos} initialPhotoId="p1" source={{ source: 'import', payloadId: 'import-1' }} accessPassword="2520" values={values} onApply={(field, value) => { onApply(field, value); setValues(current => ({ ...current, [field]: value })); }} onClose={vi.fn()} />;
}
function load() { fireEvent.load(screen.getByRole('img')); }
async function drag() {
  const surface = screen.getByRole('application', { name: '文字を囲む' });
  surface.setPointerCapture = vi.fn();
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 100, height: 100 } as DOMRect);
  await act(async () => {
    fireEvent.pointerDown(surface, { button: 0, clientX: 20, clientY: 40 });
    fireEvent.pointerMove(surface, { clientX: 50, clientY: 70 });
    fireEvent.pointerUp(surface, { clientX: 60, clientY: 70 });
  });
}

describe('InventoryPhotoReadDialog', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('PointerEvent', MouseEvent);
    vi.mocked(readInventoryPhotoRegion).mockReset().mockResolvedValue({ candidates: ['M1', 'M2'], status: 'ok' });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

  it('drags on the image, selects a candidate and places it into a field', async () => {
    const onApply = vi.fn();
    render(<Harness onApply={onApply} />);
    load();
    const photo = screen.getByLabelText('読み取り写真');
    expect(photo).toContainElement(screen.getByRole('img'));
    expect(photo).toContainElement(screen.getByRole('application'));
    expect(within(photo).queryByRole('button')).not.toBeInTheDocument();
    expect(photo).not.toContainElement(screen.getByLabelText('写真の枚数'));
    await drag();
    expect(readInventoryPhotoRegion).toHaveBeenCalledWith({ source: 'import', payloadId: 'import-1', photoId: 'p1', bbox }, '2520', expect.any(AbortSignal));
    expect(screen.getByRole('button', { name: 'M1' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'M2' }));
    fireEvent.click(screen.getByRole('button', { name: '型式に入れる' }));
    expect(onApply).toHaveBeenCalledWith('model', 'M2');
    expect(screen.getByRole('button', { name: '型式に入れる' })).toHaveTextContent('M2');
    expect(screen.getByRole('button', { name: '枠を記憶' })).toBeInTheDocument();
  });

  it.each([
    { result: { candidates: [], status: 'ok' as const }, text: '文字なし。囲み直す' },
    { result: { candidates: [], status: 'unavailable' as const }, text: '読み取れませんでした' },
  ])('shows $text next to the operation', async ({ result, text }) => {
    vi.mocked(readInventoryPhotoRegion).mockResolvedValue(result);
    render(<Harness single />); load(); await drag();
    expect(screen.getByRole('status')).toHaveTextContent(text);
    expect(screen.getByRole('button', { name: '名前に入れる' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '次の写真' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('写真の枚数')).not.toBeInTheDocument();
  });

  it('handles network failure', async () => {
    vi.mocked(readInventoryPhotoRegion).mockRejectedValue(new Error('offline'));
    render(<Harness />); load(); await drag();
    expect(screen.getByRole('status')).toHaveTextContent('読み取れませんでした');
  });

  it('remembers and replaces a field frame, reads all frames on the next photo and removes one', async () => {
    localStorage.setItem(storageKey, JSON.stringify([{ field: 'maker', bbox }, { field: 'model', bbox: { ...bbox, xRatio: 0 } }]));
    const onApply = vi.fn();
    render(<Harness onApply={onApply} />); load(); await drag();
    fireEvent.click(screen.getByRole('button', { name: '型式に入れる' }));
    fireEvent.click(screen.getByRole('button', { name: '枠を記憶' }));
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual([{ field: 'maker', bbox }, { field: 'model', bbox }]);
    expect(screen.getAllByLabelText('記憶した枠')).toHaveLength(2);
    expect(screen.getAllByLabelText('記憶した枠')[0]).toHaveClass('border-dashed');
    fireEvent.click(screen.getByRole('button', { name: '次の写真' })); load();
    expect(screen.getByRole('img')).toHaveAttribute('src', '/2.jpg');
    expect(screen.getByLabelText('写真の枚数')).toHaveTextContent('2 / 2');
    vi.mocked(readInventoryPhotoRegion).mockResolvedValueOnce({ candidates: ['OSG', 'ignored'], status: 'ok' }).mockResolvedValueOnce({ candidates: ['M3'], status: 'ok' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '記憶した枠で読む（2）' })); });
    expect(onApply).toHaveBeenCalledWith('maker', 'OSG');
    expect(onApply).toHaveBeenLastCalledWith('model', 'M3');
    expect(readInventoryPhotoRegion).toHaveBeenLastCalledWith({ source: 'import', payloadId: 'import-1', photoId: 'p2', bbox }, '2520', expect.any(AbortSignal));
    expect(screen.getByRole('status')).toHaveTextContent('2 件入れた');
    fireEvent.click(screen.getByRole('button', { name: 'メーカーの枠を消す' }));
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual([{ field: 'model', bbox }]);
    fireEvent.click(screen.getByRole('button', { name: '前の写真' }));
    expect(screen.getByRole('img')).toHaveAttribute('src', '/1.jpg');
  });

  it('reports no text from remembered frames', async () => {
    localStorage.setItem(storageKey, JSON.stringify([{ field: 'maker', bbox }]));
    vi.mocked(readInventoryPhotoRegion).mockResolvedValue({ candidates: [], status: 'ok' });
    const onApply = vi.fn();
    render(<Harness onApply={onApply} />); load();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '記憶した枠で読む（1）' })); });
    expect(screen.getByRole('status')).toHaveTextContent('文字なし');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('aborts and ignores late results after changing photos', async () => {
    let resolve!: (value: { candidates: string[]; status: 'ok' }) => void;
    vi.mocked(readInventoryPhotoRegion).mockImplementation(() => new Promise(done => { resolve = done; }));
    render(<Harness />); load(); await drag();
    expect(screen.getByRole('status')).toHaveTextContent('読み取り中…');
    const signal = vi.mocked(readInventoryPhotoRegion).mock.calls[0][2];
    fireEvent.click(screen.getByRole('button', { name: '次の写真' }));
    expect(signal?.aborted).toBe(true);
    await act(async () => { resolve({ candidates: ['old'], status: 'ok' }); });
    expect(screen.queryByRole('button', { name: 'old' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('文字を枠で囲む');
  });

  it('works when storage reads and writes throw', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<Harness />); load(); await drag();
    fireEvent.click(screen.getByRole('button', { name: '名前に入れる' }));
    fireEvent.click(screen.getByRole('button', { name: '枠を記憶' }));
    expect(screen.getByRole('button', { name: '記憶した枠で読む（1）' })).toBeEnabled();
  });

  it('ignores corrupt stored frames', () => {
    localStorage.setItem(storageKey, JSON.stringify([{ field: 'other', bbox }, { field: 'name', bbox: { ...bbox, xRatio: 2 } }]));
    render(<Harness />); load();
    expect(screen.getByRole('button', { name: '記憶した枠で読む' })).toBeDisabled();
  });
});
