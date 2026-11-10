import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { partKey } from '../loadBalancingNamedTargets';
import { LoadBalancingOutsourceSettings } from '../LoadBalancingOutsourceSettings';

import type { OutsourceSettings, ProductionScheduleLoadBalancingWorkspaceRow as Row } from '../../../../api/client';

const makeRow = (rowId: string, extra: Partial<Row> = {}): Row => ({
  rowId, fseiban: 'MD-123', productNo: '1', fhincd: 'AB-123', fhinmei: '軸', machineName: ' Ｎｖｄ ', resourceCd: 'A',
  plannedStartDate: '2026-11-01', effectiveDueDate: '2026-11-30', totalMinutes: 60, late: false,
  allocations: [{ bucket: '2026-11', minutes: 60 }], ...extra
});
const base = (): OutsourceSettings => ({ mode: 'process', order: ['due', 'minutes', 'vendor'], vendors: [
  { id: 'a', name: '加工A', priority: 1, monthlyCapacityMinutes: 60, conditions: [] },
  { id: 'b', name: '加工B', priority: 2, monthlyCapacityMinutes: null, conditions: [] }
] });
function setup(settings = base(), rows = [makeRow('1'), makeRow('2', { machineName: 'HX', fseiban: 'XY-456', fhincd: 'CD-456', fhinmei: 'カバー' })]) {
  const save = vi.fn(), close = vi.fn();
  render(<LoadBalancingOutsourceSettings settings={settings} resources={['A']} rows={rows} months={['2026-11']} today="2026-11-07" saving={false} error={null} onSave={save} onClose={close} />);
  fireEvent.click(screen.getByRole('button', { name: /^名指し/ }));
  return { save, close, candidates: () => within(screen.getByLabelText('名指し候補')), detail: () => within(screen.getByLabelText('選択業者の名指し')) };
}
describe('named settings interactions', () => {
  it('switches tabs, normalizes machine labels and closes untouched settings without saving', () => {
    const { save, close, candidates } = setup();
    expect(candidates().getByRole('button', { name: /NVD/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(close).toHaveBeenCalledOnce(); expect(save).not.toHaveBeenCalled();
  });
  it('filters by prefixes and keypad, backspace and clear, for seiban and part names/codes', () => {
    const { candidates } = setup();
    fireEvent.click(screen.getByRole('button', { name: '製番', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'MD', exact: true }));
    for (const key of ['-', '1', '2', '3']) fireEvent.click(screen.getByRole('button', { name: key, exact: true }));
    expect(screen.getByRole('textbox', { name: '検索' })).toHaveValue('MD-123');
    expect(candidates().getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '1文字消す' }));
    expect(screen.getByRole('textbox', { name: '検索' })).toHaveValue('MD-12');
    fireEvent.click(screen.getByRole('button', { name: '検索を消す' }));
    expect(candidates().getAllByRole('button')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '部品', exact: true }));
    fireEvent.change(screen.getByRole('textbox', { name: '検索' }), { target: { value: 'ａｂ－１２３' } });
    expect(candidates().getAllByRole('button')).toHaveLength(1);
    fireEvent.change(screen.getByRole('textbox', { name: '検索' }), { target: { value: 'カバー' } });
    expect(candidates().getByRole('button', { name: /カバー/ })).toBeInTheDocument();
  });
  it('selects tiles, assigns, reassigns, toggles off, and removes with ×', () => {
    const { candidates, detail, save } = setup();
    const candidate = () => candidates().getByRole('button', { name: /NVD/ });
    fireEvent.click(candidate());
    expect(detail().getByText('NVD')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '名指し業者 加工B' }));
    fireEvent.click(candidate());
    expect(candidate()).toHaveAttribute('aria-pressed', 'true');
    expect(detail().getByText('NVD')).toBeInTheDocument();
    fireEvent.click(candidate());
    expect(detail().queryByText('NVD')).not.toBeInTheDocument();
    fireEvent.click(candidate());
    fireEvent.click(detail().getByRole('button', { name: '機種 NVD を外す' }));
    expect(detail().queryByText('NVD')).not.toBeInTheDocument();
    fireEvent.click(candidate());
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ namedTargets: [{ kind: 'machine', key: 'NVD', vendorId: 'b' }] }));
  });
  it('closing after toggling an assignment twice does not save', () => {
    const { candidates, save, close } = setup();
    fireEvent.click(candidates().getByRole('button', { name: /NVD/ }));
    fireEvent.click(candidates().getByRole('button', { name: /NVD/ }));
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(save).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
  });
  it('deleting a vendor removes its named targets', () => {
    const settings = base(); settings.namedTargets = [{ kind: 'machine', key: 'NVD', vendorId: 'a' }];
    const { save } = setup(settings);
    fireEvent.click(screen.getByRole('button', { name: /^業者\s*2/ }));
    fireEvent.click(screen.getByRole('button', { name: '業者を削除' }));
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ vendors: [expect.objectContaining({ id: 'b' })], namedTargets: [] }));
  });
  it('shows total per group, prioritizes prefix matches then due date, and caps results at 40', () => {
    const rows = Array.from({ length: 45 }, (_, i) => makeRow(`${i}`, { machineName: `M${i}`, effectiveDueDate: `2026-11-${String(1 + i % 28).padStart(2, '0')}` }));
    const { candidates } = setup(base(), rows);
    expect(candidates().getAllByRole('button')).toHaveLength(40);
    fireEvent.change(screen.getByRole('textbox', { name: '検索' }), { target: { value: 'M1' } });
    expect(candidates().getAllByRole('button')[0]).toHaveTextContent('M1');
  });
  it('puts a prefix match before an earlier-due substring match', () => {
    const { candidates } = setup(base(), [makeRow('a', { machineName: 'XAB', effectiveDueDate: '2026-11-01' }), makeRow('b', { machineName: 'AB', effectiveDueDate: '2026-11-20' })]);
    fireEvent.change(screen.getByRole('textbox', { name: '検索' }), { target: { value: 'AB' } });
    expect(candidates().getAllByRole('button')[0]).toHaveTextContent(/^AB/);
  });
  it('groups before searching so a matching name keeps every process in the part total', () => {
    const rows = [makeRow('a'), makeRow('b', { fhinmei: '別名', totalMinutes: 120, effectiveDueDate: '2026-11-10' })];
    const { candidates } = setup(base(), rows);
    fireEvent.click(screen.getByRole('button', { name: '部品', exact: true }));
    fireEvent.change(screen.getByRole('textbox', { name: '検索' }), { target: { value: '別名' } });
    const result = candidates().getAllByRole('button');
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveTextContent('3H');
    expect(result[0]).toHaveTextContent('2工程・11/10');
  });
  it('counts overlap once using specificity and flags a zero-cap month including late work', () => {
    const settings = base(); settings.vendors[0]!.monthlyCapacityMinutes = 0;
    const r = makeRow('1', { allocations: [{ bucket: 'late', minutes: 60 }], late: true, effectiveDueDate: '2026-10-01' });
    settings.namedTargets = [{ kind: 'machine', key: 'NVD', vendorId: 'a' }, { kind: 'part', key: partKey(r), vendorId: 'b' }];
    setup(settings, [r]);
    expect(screen.getByRole('button', { name: '名指し業者 加工A' })).toHaveTextContent('0H / 0H');
    expect(screen.getByRole('button', { name: '名指し業者 加工B' })).toHaveTextContent('1H');
    fireEvent.click(screen.getByRole('button', { name: '部品', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '名指し業者 加工A' }));
    fireEvent.click(within(screen.getByLabelText('名指し候補')).getByRole('button', { name: /軸/ }));
    expect(screen.getByRole('button', { name: '名指し業者 加工A' })).toHaveClass('ring-rose-400');
  });
});
