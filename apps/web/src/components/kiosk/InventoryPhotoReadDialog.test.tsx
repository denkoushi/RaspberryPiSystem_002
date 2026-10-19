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
  const [open, setOpen] = useState(true);
  const [values, setValues] = useState<Partial<Record<InventoryOptionField, string>>>({});
  return open ? <InventoryPhotoReadDialog photos={single ? photos.slice(0, 1) : photos} initialPhotoId="p1" source={{ source: 'import', payloadId: 'import-1' }} accessPassword="2520" values={values} onApply={(field, value) => { onApply(field, value); setValues(current => ({ ...current, [field]: value })); }} onClose={() => setOpen(false)} /> : <button onClick={() => setOpen(true)}>開く</button>;
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

  it('edits controlled values verbatim, marks edited fields and retains them after closing', async () => {
    const onApply = vi.fn();
    render(<Harness onApply={onApply} />); load(); await drag();
    const input = screen.getByRole('textbox', { name: '型式の値' });
    expect(input.tagName).toBe('TEXTAREA');
    expect(input).toHaveAttribute('placeholder', '—');
    fireEvent.click(input);
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.compositionStart(input);
    for (const value of [' に', ' 日本語 ', '']) {
      fireEvent.change(input, { target: { value } });
      expect(onApply).toHaveBeenLastCalledWith('model', value);
      expect(input).toHaveValue(value);
    }
    fireEvent.compositionEnd(input);
    fireEvent.change(input, { target: { value: '修正した型式' } });
    expect(onApply).toHaveBeenCalledTimes(4);
    expect(input.parentElement).toHaveClass('border-inv-green');
    expect(input.parentElement).toHaveTextContent('✓');
    expect(screen.getByRole('button', { name: '枠を記憶' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '次の写真' }));
    expect(screen.getByRole('textbox', { name: '型式の値' })).toHaveValue('修正した型式');
    expect(screen.getByRole('textbox', { name: '型式の値' }).parentElement).toHaveTextContent('✓');
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    fireEvent.click(screen.getByRole('button', { name: '開く' }));
    expect(screen.getByRole('textbox', { name: '型式の値' })).toHaveValue('修正した型式');
    expect(screen.getByRole('textbox', { name: '型式の値' }).parentElement).not.toHaveTextContent('✓');
  });

  it('keeps editing keys local, blocks line breaks and allows IME confirmation and Tab', () => {
    render(<Harness />); load();
    const input = screen.getByRole('textbox', { name: '名前の値' });
    input.focus();
    const onKeyDown = vi.fn();
    window.addEventListener('keydown', onKeyDown);
    try {
      for (const key of ['a', 'Backspace', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape']) {
        expect(fireEvent.keyDown(input, { key })).toBe(true);
      }
      expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
      expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(true);
      expect(fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })).toBe(true);
      expect(onKeyDown).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(readInventoryPhotoRegion).not.toHaveBeenCalled();
      expect(screen.queryByLabelText('読み取り枠')).not.toBeInTheDocument();
      fireEvent.keyDown(input, { key: 'Tab' });
      expect(onKeyDown).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener('keydown', onKeyDown); }
    fireEvent.keyDown(screen.getByRole('button', { name: '閉じる' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('resizes textareas to their full content when values change', () => {
    render(<Harness />);
    const input = screen.getByRole('textbox', { name: '名前の値' });
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 180 });
    fireEvent.change(input, { target: { value: '長い名前'.repeat(30) } });
    expect(input).toHaveStyle({ height: '180px' });
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 46 });
    fireEvent.change(input, { target: { value: '短い名前' } });
    expect(input).toHaveStyle({ height: '46px' });
  });

  it('uses cyan candidates and apply buttons, and gray unedited input rows', async () => {
    render(<Harness />); load();
    expect(screen.getByRole('button', { name: '名前に入れる' })).toBeDisabled();
    await drag();
    expect(screen.getByRole('button', { name: 'M1' })).toHaveClass('border-2', 'border-inv-cyan', 'bg-inv-cyan', 'text-inv-cyan-ink');
    expect(screen.getByRole('button', { name: 'M2' })).toHaveClass('border-2', 'border-inv-cyan', 'bg-inv-cyan/10');
    expect(screen.getByRole('textbox', { name: '名前の値' }).parentElement).toHaveClass('border-inv-line2', 'bg-inv-bg');
    expect(screen.getByRole('textbox', { name: '名前の値' }).parentElement).not.toHaveClass('border-inv-amber');
    expect(screen.getByRole('button', { name: '名前に入れる' })).toHaveClass('border-inv-cyan', 'bg-inv-cyan/10', 'min-h-11', 'min-w-11', 'disabled:border-inv-line2');
  });

  it('deduplicates new and previous candidates and moves repeated text to the top', async () => {
    render(<Harness />); load(); await drag();
    vi.mocked(readInventoryPhotoRegion).mockResolvedValueOnce({ candidates: ['M2', 'NEW', 'M2'], status: 'ok' });
    await drag();
    expect(within(screen.getByRole('group', { name: '読み取り候補' })).getAllByRole('button').map(button => button.textContent)).toEqual(['M2', 'NEW', 'M1']);
    expect(screen.getByRole('button', { name: 'M2' })).toHaveAttribute('aria-pressed', 'true');
  });

  it.each(['empty', 'unavailable', 'failure'] as const)('retains candidates and selection after an %s read', async outcome => {
    render(<Harness />); load(); await drag();
    fireEvent.click(screen.getByRole('button', { name: 'M2' }));
    if (outcome === 'failure') vi.mocked(readInventoryPhotoRegion).mockRejectedValueOnce(new Error('offline'));
    else vi.mocked(readInventoryPhotoRegion).mockResolvedValueOnce({ candidates: [], status: outcome === 'empty' ? 'ok' : 'unavailable' });
    await drag();
    expect(within(screen.getByRole('group', { name: '読み取り候補' })).getAllByRole('button').map(button => button.textContent)).toEqual(['M1', 'M2']);
    expect(screen.getByRole('button', { name: 'M2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(outcome === 'empty' ? '文字なし。囲み直す' : '読み取れませんでした');
  });

  it('keeps the last explicitly applied frame when another field is typed', async () => {
    render(<Harness />); load(); await drag();
    fireEvent.click(screen.getByRole('button', { name: '型式に入れる' }));
    fireEvent.change(screen.getByRole('textbox', { name: '名前の値' }), { target: { value: '手入力' } });
    expect(screen.getByRole('status')).toHaveTextContent('型式に入れた');
    fireEvent.click(screen.getByRole('button', { name: '枠を記憶' }));
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual([{ field: 'model', bbox }]);
  });

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
    expect(screen.getByRole('textbox', { name: '型式の値' })).toHaveValue('M2');
    expect(screen.getByRole('button', { name: '枠を記憶' })).toBeInTheDocument();
  });

  it('keeps candidates for repeated assignments and remembers the last field', async () => {
    const onApply = vi.fn();
    render(<Harness onApply={onApply} />); load(); await drag();
    fireEvent.click(screen.getByRole('button', { name: '名前に入れる' }));
    expect(screen.getByRole('button', { name: 'M1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'M2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '型式に入れる' }));
    fireEvent.click(screen.getByRole('button', { name: 'M2' }));
    fireEvent.click(screen.getByRole('button', { name: 'メーカーに入れる' }));
    expect(onApply.mock.calls).toEqual([['name', 'M1'], ['model', 'M1'], ['maker', 'M2']]);
    expect(screen.getByRole('status')).toHaveTextContent(/^メーカーに入れた$/);
    for (const label of ['名前', '型式', 'メーカー']) {
      const field = screen.getByRole('textbox', { name: `${label}の値` }).parentElement!;
      expect(field).toHaveTextContent('✓');
      expect(field).toHaveClass('border-inv-green');
    }
    expect(screen.getByRole('button', { name: '工具名に入れる' })).not.toHaveTextContent('✓');
    fireEvent.click(screen.getByRole('button', { name: '枠を記憶' }));
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual([{ field: 'maker', bbox }]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '記憶した枠で読む（1）' })); });
    expect(screen.getByRole('button', { name: 'M1' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '用途に入れる' }));
    expect(onApply).toHaveBeenLastCalledWith('usage', 'M1');
  });

  it('prepends candidates and keeps selection and marks across photos until closing', async () => {
    render(<Harness />); load(); await drag();
    fireEvent.click(screen.getByRole('button', { name: '型式に入れる' }));
    vi.mocked(readInventoryPhotoRegion).mockResolvedValueOnce({ candidates: ['NEW'], status: 'ok' });
    await drag();
    expect(within(screen.getByRole('group', { name: '読み取り候補' })).getAllByRole('button').map(button => button.textContent)).toEqual(['NEW', 'M1', 'M2']);
    expect(screen.getByRole('button', { name: 'NEW' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '枠を記憶' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '名前に入れる' }));
    expect(screen.getByRole('button', { name: '枠を記憶' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '次の写真' })); load();
    expect(within(screen.getByRole('group', { name: '読み取り候補' })).getAllByRole('button').map(button => button.textContent)).toEqual(['NEW', 'M1', 'M2']);
    expect(screen.getByRole('button', { name: 'NEW' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '枠を記憶' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '用途に入れる' }));
    expect(screen.getByRole('textbox', { name: '用途の値' })).toHaveValue('NEW');
    expect(screen.getByRole('button', { name: '枠を記憶' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: '型式の値' }).parentElement).toHaveClass('border-inv-green');
    expect(screen.getByRole('button', { name: '型式に入れる' })).toHaveTextContent('✓');
    await drag();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '開く' })); load();
    expect(screen.getByRole('group', { name: '読み取り候補' })).toBeEmptyDOMElement();
    expect(screen.getByRole('textbox', { name: '型式の値' })).toHaveValue('M1');
    expect(screen.getByRole('button', { name: '型式に入れる' })).not.toHaveTextContent('✓');
    expect(screen.getByRole('textbox', { name: '型式の値' }).parentElement).not.toHaveClass('border-inv-green');
  });

  it('wraps long candidates and current values without truncating', async () => {
    const value = 'MSTAR-4FL-D10.0-R0.5-L75'.repeat(5);
    vi.mocked(readInventoryPhotoRegion).mockResolvedValue({ candidates: [value], status: 'ok' });
    render(<Harness />); load(); await drag();
    expect(screen.getByRole('button', { name: value })).toHaveClass('[overflow-wrap:anywhere]');
    fireEvent.click(screen.getByRole('button', { name: '型式に入れる' }));
    const current = screen.getByRole('textbox', { name: '型式の値' });
    const field = current.parentElement!;
    expect(current).toHaveValue(value);
    expect(current).toHaveClass('[field-sizing:content]', 'resize-none');
    expect(current).toHaveClass('[overflow-wrap:anywhere]');
    expect(current).not.toHaveClass('truncate');
    expect(field).not.toHaveClass('truncate');
  });

  it.each([[1440, 1080], [800, 1200]])('fits the selection surface to the %i × %i photo and keeps controls in the side pane', (width, height) => {
    render(<Harness />);
    const img = screen.getByRole('img');
    Object.defineProperties(img, { naturalWidth: { value: width }, naturalHeight: { value: height } });
    load();
    const photo = screen.getByLabelText('読み取り写真');
    expect(photo.style.aspectRatio).toBe(String(width / height));
    expect(photo).toHaveStyle({ width: `min(100%, calc(100dvh * ${width / height}))` });
    expect(img).toHaveClass('h-full', 'w-full', 'object-contain');
    expect(photo).toContainElement(screen.getByRole('application', { name: '文字を囲む' }));
    const pane = screen.getByRole('complementary');
    expect(pane).toHaveClass('overflow-hidden');
    const middle = screen.getByRole('status').parentElement!;
    expect(middle).toHaveClass('min-h-0', 'overflow-y-auto', 'overscroll-contain');
    for (const name of ['前の写真', '次の写真', '閉じる', '枠を記憶', '記憶した枠で読む']) {
      const control = screen.getByRole('button', { name });
      expect(pane).toContainElement(control);
      expect(middle).not.toContainElement(control);
    }
    expect(pane.parentElement).toHaveClass('h-dvh', 'grid-cols-[minmax(0,1fr)_480px]');
    expect(pane.parentElement?.parentElement).toHaveClass('!fixed', '!inset-0', '!border-0', '!p-0');
    expect(document.body.style.overflow).toBe('hidden');
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
    expect(screen.queryByRole('button', { name: '前の写真' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '閉じる' })).toBeInTheDocument();
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
    expect(screen.getByRole('textbox', { name: 'メーカーの値' }).parentElement).toHaveClass('border-inv-green');
    expect(screen.getByRole('button', { name: 'メーカーに入れる' })).toHaveTextContent('✓');
    expect(onApply).toHaveBeenLastCalledWith('model', 'M3');
    expect(within(screen.getByRole('group', { name: '読み取り候補' })).getAllByRole('button').map(button => button.textContent)).toEqual(['M3', 'OSG', 'ignored', 'M1', 'M2']);
    expect(screen.getByRole('button', { name: 'M3' })).toHaveAttribute('aria-pressed', 'true');
    expect(readInventoryPhotoRegion).toHaveBeenLastCalledWith({ source: 'import', payloadId: 'import-1', photoId: 'p2', bbox }, '2520', expect.any(AbortSignal));
    expect(screen.getByRole('status')).toHaveTextContent('2 件入れた');
    fireEvent.click(screen.getByRole('button', { name: 'メーカーの枠を消す' }));
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual([{ field: 'model', bbox }]);
    fireEvent.click(screen.getByRole('button', { name: '前の写真' }));
    expect(screen.getByRole('img')).toHaveAttribute('src', '/1.jpg');
  });

  it.each(['empty', 'unavailable', 'failure'] as const)('retains candidates after an %s read from remembered frames', async outcome => {
    localStorage.setItem(storageKey, JSON.stringify([{ field: 'maker', bbox }]));
    const onApply = vi.fn();
    render(<Harness onApply={onApply} />); load(); await drag();
    fireEvent.click(screen.getByRole('button', { name: 'M2' }));
    if (outcome === 'failure') vi.mocked(readInventoryPhotoRegion).mockRejectedValueOnce(new Error('offline'));
    else vi.mocked(readInventoryPhotoRegion).mockResolvedValueOnce({ candidates: [], status: outcome === 'empty' ? 'ok' : 'unavailable' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '記憶した枠で読む（1）' })); });
    expect(screen.getByRole('status')).toHaveTextContent(outcome === 'empty' ? '文字なし' : '読み取れませんでした');
    expect(within(screen.getByRole('group', { name: '読み取り候補' })).getAllByRole('button').map(button => button.textContent)).toEqual(['M1', 'M2']);
    expect(screen.getByRole('button', { name: 'M2' })).toHaveAttribute('aria-pressed', 'true');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('aborts and ignores late results after changing photos', async () => {
    let resolve!: (value: { candidates: string[]; status: 'ok' }) => void;
    render(<Harness />); load(); await drag();
    fireEvent.click(screen.getByRole('button', { name: 'M2' }));
    vi.mocked(readInventoryPhotoRegion).mockImplementation(() => new Promise(done => { resolve = done; }));
    await drag();
    expect(screen.getByRole('status')).toHaveTextContent('読み取り中…');
    expect(screen.getByRole('button', { name: '名前に入れる' })).toBeDisabled();
    const signal = vi.mocked(readInventoryPhotoRegion).mock.calls[1][2];
    fireEvent.click(screen.getByRole('button', { name: '次の写真' }));
    expect(signal?.aborted).toBe(true);
    await act(async () => { resolve({ candidates: ['old'], status: 'ok' }); });
    expect(screen.queryByRole('button', { name: 'old' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'M1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'M2' })).toHaveAttribute('aria-pressed', 'true');
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
