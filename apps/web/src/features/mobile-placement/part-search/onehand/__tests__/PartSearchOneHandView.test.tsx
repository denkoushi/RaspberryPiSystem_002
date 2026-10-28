import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PartSearchOneHandView } from '../PartSearchOneHandView';

import type { PartSearchRow } from '@raspi-system/part-search-core';

const rows: PartSearchRow[] = [
  { id: '1', shelfCodeRaw: 'A01-1', fseiban: 'BE01', fhincd: 'P-01', fhinmei: 'テーブル', machineName: 'DAD3350', productNo: '1', manufacturingOrder: '012345', branchNo: 0 },
  { id: '2', shelfCodeRaw: 'B02-2', fseiban: 'BE02', fhincd: 'P-02', fhinmei: 'パルプ', machineName: 'DFD6362', productNo: '2', branchNo: 2 }
];
function mount(onDelete = vi.fn<(row: PartSearchRow) => Promise<void>>().mockResolvedValue(undefined)) {
  return { ...render(<PartSearchOneHandView rows={rows} offline={false} onDelete={onDelete} />), onDelete };
}
const key = (name: string) => screen.getByRole('button', { name });
const field = (name: string) => within(screen.getByRole('group', { name: 'さがす項目' })).getByRole('button', { name });
const results = () => screen.getByRole('region', { name: '検索結果' });

describe('PartSearchOneHandView', () => {
  it('types kana keys to filter the list with folded matches; clear restores all rows', () => {
    mount();
    for (const char of 'てふる') fireEvent.click(key(char));
    expect(screen.getByRole('textbox', { name: '検索文字' })).toHaveValue('てふる');
    expect(within(results()).getByText('テーブル')).toBeInTheDocument();
    expect(within(results()).queryByText('パルプ')).not.toBeInTheDocument();
    expect(screen.getByText('1件', { exact: true })).toBeInTheDocument();
    fireEvent.click(key('全部消す'));
    expect(within(results()).getByText('パルプ')).toBeInTheDocument();
    expect(field('全部')).toHaveAttribute('aria-pressed', 'true');
  });

  it('adds tags as filters and advances through machine → seiban → name → hinban', () => {
    mount();
    fireEvent.click(key('機種 DAD3350 でしぼる'));
    expect(key('機種 DAD3350 を外す')).toBeInTheDocument();
    expect(field('製番')).toHaveAttribute('aria-pressed', 'true');
    expect(key('英数')).toHaveAttribute('aria-pressed', 'true');
    expect(within(results()).queryByText('パルプ')).not.toBeInTheDocument();
    fireEvent.click(key('製番 BE01 でしぼる'));
    expect(field('品名')).toHaveAttribute('aria-pressed', 'true');
    expect(key('かな')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(key('て'));
    fireEvent.click(key('品名 テーブル 1件でしぼる'));
    expect(field('品番')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(key('品番 P-01 でしぼる'));
    expect(field('全部')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(key('機種 DAD3350 を外す'));
    expect(field('機種')).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps unavailable keys disabled in place and pops the last filter with 1字消す', () => {
    mount();
    expect(key('あ')).toBeDisabled();
    expect(key('て')).toBeEnabled();
    expect(key('は')).toBeEnabled();
    const before = [...screen.getByLabelText('文字キー').querySelectorAll('button')].map((button) => button.textContent);
    fireEvent.click(key('て'));
    expect(key('は')).toBeDisabled();
    expect([...screen.getByLabelText('文字キー').querySelectorAll('button')].map((button) => button.textContent)).toEqual(before);
    fireEvent.click(key('1文字消す'));
    expect(screen.getByRole('textbox')).toHaveValue('');
    fireEvent.click(key('機種 DAD3350 でしぼる'));
    fireEvent.click(key('製番 BE01 でしぼる'));
    fireEvent.click(key('1文字消す'));
    expect(screen.queryByRole('button', { name: '製番 BE01 を外す' })).not.toBeInTheDocument();
    expect(key('機種 DAD3350 を外す')).toBeInTheDocument();
    expect(field('製番')).toHaveAttribute('aria-pressed', 'true');
  });

  it('hides keys on card expand and scrolling, retaining mode and field controls', () => {
    mount();
    fireEvent.click(key('A01-1 テーブル'));
    expect(screen.queryByLabelText('文字キー')).not.toBeInTheDocument();
    expect(screen.getByText('なし')).toBeInTheDocument();
    expect(screen.getByText('012345')).toBeInTheDocument();
    expect(field('機種')).toBeVisible();
    expect(key('英数')).toBeVisible();
    fireEvent.click(screen.getByRole('textbox'));
    expect(screen.getByLabelText('文字キー')).toBeInTheDocument();
    fireEvent.scroll(results(), { target: { scrollTop: 50 } });
    expect(screen.queryByLabelText('文字キー')).not.toBeInTheDocument();
    fireEvent.click(key('キーを出す'));
    expect(screen.getByLabelText('文字キー')).toBeInTheDocument();
    fireEvent.click(key('キーをしまう'));
    expect(screen.queryByLabelText('文字キー')).not.toBeInTheDocument();
  });

  it('switches field keyboard modes and accepts pasted/native input', () => {
    mount();
    for (const name of ['製番', '品番', '機種']) {
      fireEvent.click(field(name));
      expect(key('英数')).toHaveAttribute('aria-pressed', 'true');
      expect(key('-')).toBeInTheDocument();
    }
    fireEvent.click(field('品名'));
    expect(key('かな')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ばるぶ' } });
    expect(within(results()).getByText('パルプ')).toBeInTheDocument();
    expect(within(results()).queryByText('テーブル')).not.toBeInTheDocument();
  });

  it('confirms deletion, prevents double submission, and removes a successful row', async () => {
    let resolve!: () => void;
    const onDelete = vi.fn<(row: PartSearchRow) => Promise<void>>(() => new Promise((done) => { resolve = done; }));
    const { container } = mount(onDelete);
    expect(container.querySelector('button button')).toBeNull();
    fireEvent.click(key('A01-1 テーブル'));
    fireEvent.click(key('この品物を消す'));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(key('やめる'));
    fireEvent.click(key('この品物を消す'));
    fireEvent.click(key('本当に消す'));
    expect(key('本当に消す')).toBeDisabled();
    expect(key('やめる')).toBeDisabled();
    fireEvent.click(key('本当に消す'));
    expect(onDelete).toHaveBeenCalledExactlyOnceWith(rows[0]);
    await act(async () => resolve());
    expect(within(results()).queryByText('テーブル')).not.toBeInTheDocument();
    expect(screen.getByText('1件', { exact: true })).toBeInTheDocument();
  });

  it('resets confirmation on collapse and shows delete failures beside the action', async () => {
    mount(vi.fn<(row: PartSearchRow) => Promise<void>>().mockRejectedValue(new Error('消せませんでした')));
    fireEvent.click(key('A01-1 テーブル'));
    fireEvent.click(key('この品物を消す'));
    fireEvent.click(key('A01-1 テーブル'));
    fireEvent.click(key('A01-1 テーブル'));
    expect(key('この品物を消す')).toBeInTheDocument();
    fireEvent.click(key('この品物を消す'));
    fireEvent.click(key('本当に消す'));
    expect(await screen.findByRole('alert')).toHaveTextContent('消せませんでした');
    expect(key('この品物を消す')).toBeInTheDocument();
    expect(within(results()).getByText('テーブル')).toBeInTheDocument();
  });

  it('accepts the offline chip slot and recomputes when rows change', () => {
    const { rerender } = render(<PartSearchOneHandView rows={rows} offline topLeftChip={<span>圏外 10/28</span>} onDelete={vi.fn()} />);
    expect(screen.getByText('圏外 10/28')).toBeInTheDocument();
    rerender(<PartSearchOneHandView rows={[]} offline={false} onDelete={vi.fn()} />);
    expect(screen.getByText('見つかりません')).toBeInTheDocument();
    expect(key('て')).toBeDisabled();
  });
});
