import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HaizenScheduleDetail } from './HaizenScheduleDetail';
import { HaizenScheduleList } from './HaizenScheduleList';
import { formatScheduleDate, scheduleDateColor } from './scheduleDisplay';

import type { ScheduleSeibanDetail } from '../../../api/domains/schedule-seibans';

const mocks = vi.hoisted(() => ({ list: vi.fn(), detail: null as ScheduleSeibanDetail | null }));
vi.mock('../../../api/hooks/schedule-seibans', () => ({
  useScheduleSeibans: (view: unknown) => { mocks.list(view); return ({ data: { seibans: [mocks.detail, { ...mocks.detail, fseiban: 'READY', counts: { shelf: 2, verified: 0, pending: 0, done: 1 } }], truncated: false }, isPending: false }); },
  useScheduleSeiban: () => ({ data: mocks.detail, isPending: false })
}));
vi.mock('../useRegisteredShelves', () => ({ useRegisteredShelves: () => ({ data: { shelves: [{ shelfCodeRaw: 'A', displayLabel: '北の棚', isStructured: false }] } }) }));
vi.mock('../shelfPhoto/ShelfPhoto', () => ({ ShelfPhoto: ({ label }: { label: string }) => <span>{label} 写真</span> }));
vi.mock('./HaizenShelfPhotoViewer', () => ({ HaizenShelfPhotoViewer: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div> }));

function Location() { const location = useLocation(); return <output>{location.pathname}{location.search}</output>; }
function mount(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/kiosk/mobile-placement/schedule-seibans" element={<HaizenScheduleList />} />
    <Route path="/kiosk/mobile-placement/schedule-seibans/:fseiban" element={<HaizenScheduleDetail />} />
    <Route path="/kiosk/mobile-placement" element={<Location />} />
  </Routes></MemoryRouter>);
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.detail = {
    fseiban: 'S001', aliasFseibans: ['S002'], partsCompleteDate: '2026-11-06', sendOutDate: '2026-11-05', outsourceMarks: ['X', 'Y'], memo: 'メモ', machineName: '機種A',
    counts: { shelf: 4, verified: 1, pending: 1, done: 1 },
    parts: [
      ...[1, 2, 3, 4].map(index => ({ productNo: `P${index}`, fhincd: `棚品番${index}`, fhinmei: `棚部品${index}`, state: 'shelf' as const, shelfCodeRaw: 'A', shelfLabel: '北の棚' })),
      { productNo: 'P5', fhincd: '照合品番', fhinmei: '照合部品', state: 'verified' },
      { productNo: 'P6', fhincd: '未照合品番', fhinmei: '未照合部品', state: 'pending' },
      { productNo: 'P7', fhincd: '完了品番', fhinmei: '完了部品', state: 'done' }
    ]
  };
});

describe('日程一覧', () => {
  it('完成日・曜日・印・棚件数と状態の割合を表示し、揃っていない製番に絞る', () => {
    mount('/kiosk/mobile-placement/schedule-seibans');
    expect(screen.getAllByText('11/6 金')).toHaveLength(2);
    expect(screen.getByText('4/6')).toBeInTheDocument();
    expect(screen.getAllByText(/\(XY\)/)).toHaveLength(2);
    expect(screen.getByRole('img', { name: '棚にある 4、照合済み 1、まだ 1、完了 1' })).toBeInTheDocument();
    expect(screen.getByText('READY')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '揃っていない' }));
    expect(screen.queryByText('READY')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /S001/ }));
    expect(screen.getByRole('heading', { name: 'S001' })).toBeInTheDocument();
  });
});

describe('製番詳細', () => {
  it('初期はまだ、状態を切り替え、棚写真からその棚の部品全件を表示する', () => {
    mount('/kiosk/mobile-placement/schedule-seibans/S001');
    expect(screen.getByRole('button', { name: 'まだ 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('S002')).toBeInTheDocument();
    expect(screen.getByText('メモ')).toBeInTheDocument();
    expect(screen.getByText('未照合品番')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '照合済み 1' }));
    expect(screen.getByText('照合品番')).toBeInTheDocument();
    expect(screen.queryByText('未照合品番')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '完了 1' }));
    expect(screen.getByText('完了品番').closest('button')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '棚にある 4' }));
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.queryByText('棚品番4')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /北の棚 写真/ }));
    expect(within(screen.getByRole('dialog')).getByText('棚品番4')).toBeInTheDocument();
  });
  it('部品から照合へ製番とProductNoを渡す', () => {
    mount('/kiosk/mobile-placement/schedule-seibans/S001');
    fireEvent.click(screen.getByRole('button', { name: /未照合品番/ }));
    expect(screen.getByRole('status')).toHaveTextContent('/kiosk/mobile-placement?scheduleFseiban=S001&scheduleProductNo=P6');
  });
  it('画面下の照合ボタンを表示せず、部品の文字を拡大する', () => {
    mount('/kiosk/mobile-placement/schedule-seibans/S001');
    expect(screen.queryByRole('button', { name: '照合', exact: true })).not.toBeInTheDocument();
    expect(screen.getByText('未照合品番')).toHaveClass('text-[20px]');
    expect(screen.getByText('未照合部品')).toHaveClass('text-[18px]');
  });
});

it('日付の3日・7日境界を共通定数で判定し、JSTの曜日を表示する', () => {
  const now = new Date('2026-11-04T12:00:00+09:00');
  expect(scheduleDateColor('2026-11-07', now)).toBe('var(--hp-ng)');
  expect(scheduleDateColor('2026-11-08', now)).toBe('var(--hp-shelf)');
  expect(scheduleDateColor('2026-11-11', now)).toBe('var(--hp-shelf)');
  expect(scheduleDateColor('2026-11-12', now)).toBe('var(--hp-ink)');
  expect(formatScheduleDate(null)).toBe('—');
  expect(formatScheduleDate('2026-11-06')).toBe('11/6 金');
});

it('区分と範囲を保存し、再表示で復元して一覧queryへ渡す', () => {
  const first = mount('/kiosk/mobile-placement/schedule-seibans');
  expect(mocks.list).toHaveBeenLastCalledWith({ source: 'both', range: 'all' });
  fireEvent.click(screen.getByRole('button', { name: '区分', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'D社', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '範囲', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '前後1ヶ月', exact: true }));
  expect(JSON.parse(localStorage.getItem('haizen-schedule-view')!)).toEqual({ schemaVersion: 1, source: 'dCompany', range: 'aroundMonth' });
  first.unmount();
  mount('/kiosk/mobile-placement/schedule-seibans');
  expect(screen.getByRole('button', { name: '区分', exact: true })).toHaveTextContent('D社');
  expect(screen.getByRole('button', { name: '範囲', exact: true })).toHaveTextContent('前後1ヶ月');
  expect(mocks.list).toHaveBeenLastCalledWith({ source: 'dCompany', range: 'aroundMonth' });
});
it.each(['{', 'null', '{"schemaVersion":2,"source":"general","range":"all"}', '{"schemaVersion":1,"source":"unknown","range":"all"}', '{"schemaVersion":1,"source":"general","range":"unknown"}'])('壊れた保存値 %s は既定値へ戻す', saved => {
  localStorage.setItem('haizen-schedule-view', saved);
  mount('/kiosk/mobile-placement/schedule-seibans');
  expect(screen.getByRole('button', { name: '区分', exact: true })).toHaveTextContent('一般・D社');
  expect(screen.getByRole('button', { name: '範囲', exact: true })).toHaveTextContent('全期間');
  expect(mocks.list).toHaveBeenLastCalledWith({ source: 'both', range: 'all' });
});

it('localStorageの読み書きが禁止されても既定値で開き、選択を変更できる', () => {
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  try {
    mount('/kiosk/mobile-placement/schedule-seibans');
    expect(mocks.list).toHaveBeenLastCalledWith({ source: 'both', range: 'all' });
    fireEvent.click(screen.getByRole('button', { name: '区分', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '一般', exact: true }));
    expect(mocks.list).toHaveBeenLastCalledWith({ source: 'general', range: 'all' });
    expect(screen.getByRole('button', { name: '区分', exact: true })).toHaveTextContent('一般');
  } finally { read.mockRestore(); write.mockRestore(); }
});
