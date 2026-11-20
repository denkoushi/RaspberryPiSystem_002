import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { effectiveVerifyResult } from '../../features/kiosk/haizen/haizenVerifyResult';

import { KioskHaizenVerifyHistoryPage } from './KioskHaizenVerifyHistoryPage';

import type { HaizenVerifyRecord } from '../../features/kiosk/haizen/haizenRecordTypes';

const hooks = vi.hoisted(() => ({ records: [] as unknown[] }));
vi.mock('../../api/hooks/haizen-records', () => ({
  useHaizenVerifyRecords: () => ({ data: { records: hooks.records }, dataUpdatedAt: 0, isError: false, isPending: false })
}));
vi.mock('../../api/hooks/haizen-overview', () => ({ useHaizenShelves: () => ({ data: { shelves: [] } }) }));

const make = (id: string, order: string, result: HaizenVerifyRecord['result'], recheck: HaizenVerifyRecord['recheckOutcome'] = null): HaizenVerifyRecord => ({
  id, verifiedAt: `2026-11-1${id}T03:00:00.000Z`, deviceName: 'スマホ', result, reason: null,
  recheckOutcome: recheck, recheckReason: recheck, recheckedAt: recheck ? '2026-11-20T00:30:00.000Z' : null,
  transfer: { orderNo: order, partNo: null, fseiban: null }, actual: { slipNo: null, partNo: null, fseiban: null },
  mismatch: null, fhinmei: null, machineName: null, placedShelfCodeRaw: null, branchNo: null
});
afterEach(cleanup);
const mount = () => render(<MemoryRouter><KioskHaizenVerifyHistoryPage /></MemoryRouter>);
const filterLabel = (name: string) => within(screen.getByRole('group', { name: '結果' })).getByRole('button', { name: new RegExp(`^${name}`) }).textContent;

describe('effectiveVerifyResult', () => {
  it('prefers the recheck outcome over the original', () => {
    expect(effectiveVerifyResult(make('1', 'A', 'not_found', 'match'))).toBe('match');
    expect(effectiveVerifyResult(make('1', 'A', 'not_found', 'mismatch'))).toBe('mismatch');
    expect(effectiveVerifyResult(make('1', 'A', 'not_found'))).toBe('not_found');
  });
});

describe('KioskHaizenVerifyHistoryPage recheck', () => {
  it('counts and filters by the effective outcome', () => {
    hooks.records = [make('1', 'A', 'match'), make('2', 'B', 'not_found', 'match'), make('3', 'C', 'not_found', 'mismatch'), make('4', 'D', 'not_found')];
    mount();
    expect(filterLabel('全部')).toBe('全部 4');
    expect(filterLabel('一致')).toBe('一致 2');
    expect(filterLabel('不一致')).toBe('不一致 1');
    expect(filterLabel('未登録')).toBe('未登録 1');
    fireEvent.click(within(screen.getByRole('group', { name: '結果' })).getByRole('button', { name: /^一致/ }));
    const table = screen.getByRole('table', { name: '照合の記録' });
    expect(within(table).getByText('A')).toBeInTheDocument();
    expect(within(table).getByText('B')).toBeInTheDocument();
    expect(within(table).queryByText('C')).toBeNull();
  });
  it('keeps the original mark and overlays a badge only for rechecked rows', () => {
    hooks.records = [make('2', 'A', 'not_found', 'match'), make('1', 'B', 'not_found')];
    mount();
    const rows = within(screen.getByRole('table', { name: '照合の記録' })).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByRole('button', { name: /^未登録/ }).textContent).toBe('?');
    expect(within(rows[0]).getByTestId('recheck-badge').textContent).toBe('✓');
    expect(within(rows[1]).queryByTestId('recheck-badge')).toBeNull();
  });
  it('shows the recheck line with the recheck time in the detail panel', () => {
    hooks.records = [make('1', 'A', 'not_found', 'mismatch')];
    mount();
    const line = screen.getByTestId('recheck-line');
    expect(within(line).getByText('不一致')).toBeInTheDocument();
    expect(line.textContent).toMatch(/×.*不一致.*11\/20 \d{2}:30/);
  });
  it('shows no recheck line without a recheck', () => {
    hooks.records = [make('1', 'A', 'not_found')];
    mount();
    expect(screen.queryByTestId('recheck-line')).toBeNull();
  });
});
