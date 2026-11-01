import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';

import { makeCheckSheetFixture } from './checkSheet.fixture';
import { OpenCheckSheetButton } from './OpenCheckSheetButton';
const mocks = vi.hoisted(() => ({ open: vi.fn(), list: vi.fn(), navigate: vi.fn() }));
vi.mock('../../../api/domains/assembly/check-sheets', () => ({ openAssemblyCheckSheet: mocks.open, listAssemblyCheckSheetRevisions: mocks.list }));
vi.mock('react-router-dom', async (importOriginal) => ({ ...await importOriginal<typeof import('react-router-dom')>(), useNavigate: () => mocks.navigate }));
beforeEach(() => vi.resetAllMocks());
it('opens the unit sheet without a chooser when the API can resolve it', async () => {
  mocks.open.mockResolvedValue({ id: 'existing' });
  render(<MemoryRouter><OpenCheckSheetButton workUnitId="unit" className="" /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'チェックシート' }));
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/kiosk/assembly/check-sheets/existing'));
  expect(mocks.open).toHaveBeenCalledWith('unit', undefined);
});
it('offers revision roots only when ambiguous and opens the selected model', async () => {
  mocks.open.mockRejectedValueOnce({ response: { data: { errorCode: 'CHECK_SHEET_REVISION_REQUIRED' } } }).mockResolvedValue({ id: 'created' });
  mocks.list.mockResolvedValue([makeCheckSheetFixture().revision]);
  render(<MemoryRouter><OpenCheckSheetButton workUnitId="unit" className="" /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'チェックシート' }));
  fireEvent.change(await screen.findByRole('combobox', { name: 'チェックシートの機種' }), { target: { value: 'root' } });
  await waitFor(() => expect(mocks.open).toHaveBeenLastCalledWith('unit', 'root'));
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/kiosk/assembly/check-sheets/created'));
});
it('shows an error next to the button when no head exists', async () => {
  mocks.open.mockRejectedValue({ response: { data: { errorCode: 'CHECK_SHEET_REVISION_REQUIRED' } } });
  mocks.list.mockResolvedValue([]);
  render(<MemoryRouter><OpenCheckSheetButton workUnitId="unit" className="" /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'チェックシート' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('チェックシートがありません');
});
