import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { ProductionScheduleSameModelResourceGroupsCard } from './ProductionScheduleSameModelResourceGroupsCard';
const mocks = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn(), sites: [] as { key: string; displayName: string }[], data: { siteKey: 'site', groups: [] as { resourceCds: string[] }[], resources: [
  { resourceCd: '021', resourceName: 'HCN1号機' }, { resourceCd: '022', resourceName: 'HCN2号機' }, { resourceCd: '023', resourceName: 'HCN3号機' }
] } }));
vi.mock('../../api/hooks', () => ({
  useSites: () => ({ data: mocks.sites }),
  useProductionScheduleSameModelResourceGroups: (location: string) => { mocks.read(location); return { data: mocks.data, isFetching: false }; },
  useUpdateProductionScheduleSameModelResourceGroups: () => ({ mutateAsync: mocks.save, isPending: false })
}));
beforeEach(() => {
  mocks.save.mockReset(); mocks.read.mockClear(); mocks.data.groups = [];
  mocks.sites = [{ key: 'shared', displayName: '共通' }, { key: 'factory-1', displayName: '第1工場' }, { key: 'factory-2', displayName: '第2工場' }];
});
const renderCard = () => render(<ProductionScheduleSameModelResourceGroupsCard />);
it('adds machines, excludes used candidates and rejects a one-machine group before saving', async () => {
  renderCard(); fireEvent.click(screen.getByText('組を追加'));
  fireEvent.change(screen.getByLabelText('1組に機械を追加'), { target: { value: '021' } });
  expect(screen.getByText('HCN1号機')).toBeInTheDocument();
  expect(within(screen.getByLabelText('1組に機械を追加')).queryByText('021 HCN1号機')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('保存'));
  expect(screen.getByRole('alert')).toHaveTextContent('組には機械を2台以上入れてください'); expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('1組に機械を追加'), { target: { value: '022' } });
  fireEvent.click(screen.getByText('保存'));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ location: 'factory-1', groups: [{ resourceCds: ['021', '022'] }] }));
  fireEvent.click(screen.getByLabelText('021を外す')); expect(screen.queryByText('HCN1号機')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('削除')); expect(screen.queryByLabelText('1組に機械を追加')).not.toBeInTheDocument();
});
it('shows conflicting part numbers from a 409 response', async () => {
  mocks.data.groups = [{ resourceCds: ['021', '022'] }];
  mocks.save.mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { details: { fhincds: ['P1', 'P2'] } } } });
  renderCard(); fireEvent.click(screen.getByText('保存'));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('P1、P2'));
});
it('selects the first registered factory and saves a different factory independently', async () => {
  renderCard();
  const select = screen.getByLabelText('工場');
  expect(select).toHaveValue('factory-1');
  expect(within(select).getAllByRole('option').map((option) => (option as HTMLOptionElement).value)).toEqual(['factory-1', 'factory-2']);
  expect(mocks.read).toHaveBeenLastCalledWith('factory-1');
  fireEvent.change(select, { target: { value: 'factory-2' } });
  expect(mocks.read).toHaveBeenLastCalledWith('factory-2');
  fireEvent.click(screen.getByText('保存'));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ location: 'factory-2', groups: [] }));
});
it('waits for actual factories and never saves shared when none are available', () => {
  mocks.sites = [{ key: 'shared', displayName: '共通' }];
  const view = renderCard();
  expect(screen.getByLabelText('工場')).toBeDisabled();
  expect(screen.getByText('保存')).toBeDisabled();
  fireEvent.click(screen.getByText('保存'));
  expect(mocks.save).not.toHaveBeenCalled();
  mocks.sites = [{ key: 'factory-1', displayName: '第1工場' }];
  view.rerender(<ProductionScheduleSameModelResourceGroupsCard />);
  expect(screen.getByLabelText('工場')).toHaveValue('factory-1');
  expect(mocks.read).toHaveBeenLastCalledWith('factory-1');
});
