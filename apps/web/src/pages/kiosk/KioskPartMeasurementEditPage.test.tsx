import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HermesPageContextProvider, useHermesPageContext } from '../../components/hermes/HermesPageContext';

import { KioskPartMeasurementEditPage } from './KioskPartMeasurementEditPage';

import type { HermesPageContext } from '../../api/domains/assembly';
import type { PartMeasurementSheetDto } from '../../features/part-measurement/types';
import type { NfcEvent } from '../../hooks/useNfcStream';

const mocks = vi.hoisted(() => ({ getSheet: vi.fn(), cancelSheet: vi.fn(), patchSheet: vi.fn(), transferLock: vi.fn(), nfcEvent: null as NfcEvent | null }));
vi.mock('../../api/client', () => ({
  getResolvedClientKey: () => 'test-client',
  getPartMeasurementSheet: mocks.getSheet,
  cancelPartMeasurementSheet: mocks.cancelSheet,
  downloadPartMeasurementSheetCsv: vi.fn(),
  finalizePartMeasurementSheet: vi.fn(),
  patchPartMeasurementSheet: mocks.patchSheet,
  transferPartMeasurementEditLock: mocks.transferLock,
}));
vi.mock('../../hooks/useNfcStream', () => ({ useNfcStream: () => mocks.nfcEvent }));
vi.mock('../../features/part-measurement/usePartMeasurementDrawingBlobUrl', () => ({
  usePartMeasurementDrawingBlobUrl: () => ({ blobUrl: null, error: null }),
}));

function buildSheet(fhincd = ' FH001 ', id = 'sheet-1'): PartMeasurementSheetDto {
  return {
    id, sessionId: 'session-1', status: 'FINALIZED', productNo: 'product-1', fseiban: 'serial-1', fhincd, fhinmei: '部品A',
    machineName: null, resourceCdSnapshot: null, processGroupSnapshot: 'cutting',
    employeeId: null, employeeNameSnapshot: null, createdByEmployeeId: null, createdByEmployeeNameSnapshot: null,
    finalizedByEmployeeId: null, finalizedByEmployeeNameSnapshot: null, quantity: 1, scannedBarcodeRaw: null,
    templateId: null, clientDeviceId: null, clientDeviceName: null, editLockClientDeviceId: null,
    editLockExpiresAt: null, editLockClientDeviceName: null, cancelledAt: null, cancelReason: null,
    invalidatedAt: null, invalidatedReason: null, createdAt: '2026-10-08', updatedAt: '2026-10-08',
    finalizedAt: '2026-10-08', template: null, results: [], employee: null,
  };
}

function ContextObserver({ onChange }: { onChange: (context: HermesPageContext | null) => void }) {
  const { pageContext } = useHermesPageContext();
  const navigate = useNavigate();
  useEffect(() => onChange(pageContext), [onChange, pageContext]);
  return <>
    <output data-testid="page-context">{JSON.stringify(pageContext)}</output>
    <button onClick={() => navigate('/kiosk')}>leave page</button>
    <button onClick={() => navigate('/kiosk/part-measurement/edit/sheet-2')}>next sheet</button>
  </>;
}

function pageTree(onChange = vi.fn(), initialEntry = '/kiosk/part-measurement/edit/sheet-1') {
  return <MemoryRouter initialEntries={[initialEntry]}>
    <HermesPageContextProvider>
      <ContextObserver onChange={onChange} />
      <Routes>
        <Route path="/kiosk" element={<div>home</div>} />
        <Route path="/kiosk/part-measurement" element={<div>measurement list</div>} />
        <Route path="/kiosk/part-measurement/edit/:sheetId" element={<KioskPartMeasurementEditPage />} />
      </Routes>
    </HermesPageContextProvider>
  </MemoryRouter>;
}

describe('KioskPartMeasurementEditPage Hermes context', () => {
  beforeEach(() => {
    mocks.getSheet.mockReset().mockResolvedValue({ sheet: buildSheet(), session: null });
    mocks.cancelSheet.mockReset().mockResolvedValue(undefined);
    mocks.patchSheet.mockReset();
    mocks.transferLock.mockReset();
    mocks.nfcEvent = null;
  });

  it('separates draft cancellation from save and places back before the confirmed cancellation', async () => {
    mocks.getSheet.mockResolvedValue({ sheet: { ...buildSheet(), status: 'DRAFT' }, session: null });
    render(pageTree());
    const cancel = await screen.findByRole('button', { name: '下書き取消' });
    const actions = within(screen.getByRole('region', { name: '操作とシート概要' })).getAllByRole('button');
    expect(actions[0]).toBe(cancel);
    expect(actions.at(-1)).toBe(screen.getByRole('button', { name: '手動保存' }));
    expect(cancel).toHaveClass('mr-6', 'min-h-11', '!border-[#e5484d]', '!text-[#e5484d]');
    fireEvent.click(cancel);
    const back = screen.getByRole('button', { name: '戻る' });
    expect(back.nextElementSibling).toBe(screen.getByRole('button', { name: '取消する' }));
    fireEvent.click(back);
    expect(screen.queryByRole('button', { name: '取消する' })).not.toBeInTheDocument();
    expect(mocks.cancelSheet).not.toHaveBeenCalled();
    fireEvent.click(cancel);
    fireEvent.click(screen.getByRole('button', { name: '取消する' }));
    expect(mocks.cancelSheet).not.toHaveBeenCalled();
    expect(screen.getByText('取消理由を入力してください。')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('取消理由（必須）'), { target: { value: '誤登録' } });
    fireEvent.click(screen.getByRole('button', { name: '取消する' }));
    await waitFor(() => expect(mocks.cancelSheet).toHaveBeenCalledWith('sheet-1', '誤登録', 'test-client'));
    expect(await screen.findByText('measurement list')).toBeInTheDocument();
  });

  it.each(['閉じる', '引き継ぐ'])('places close before lock transfer and preserves %s behavior', async (action) => {
    const draft = { ...buildSheet(), status: 'DRAFT' as const };
    mocks.getSheet.mockResolvedValue({ sheet: draft, session: null });
    mocks.nfcEvent = { uid: 'employee-tag', timestamp: '2026-10-13T00:00:00Z' };
    mocks.patchSheet.mockRejectedValue({ response: { status: 409 } });
    mocks.transferLock.mockResolvedValue({ sheet: draft, session: null });
    render(pageTree());
    const close = await screen.findByRole('button', { name: '閉じる' });
    expect(close.nextElementSibling).toBe(screen.getByRole('button', { name: '引き継ぐ' }));
    fireEvent.click(screen.getByRole('button', { name: action }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '引き継ぐ' })).not.toBeInTheDocument());
    if (action === '閉じる') {
      expect(mocks.transferLock).not.toHaveBeenCalled();
    } else {
      expect(mocks.transferLock).toHaveBeenCalledWith('sheet-1', { confirm: true }, 'test-client');
    }
  });

  it('sets the trimmed part and path, preserves context on unrelated renders, and clears on unmount', async () => {
    const onChange = vi.fn();
    const view = render(pageTree(onChange));
    await waitFor(() => expect(screen.getByTestId('page-context')).toHaveTextContent('FH001'));
    expect(JSON.parse(screen.getByTestId('page-context').textContent!)).toEqual({
      path: '/kiosk/part-measurement/edit/sheet-1', entity: { kind: 'partNumber', value: 'FH001' },
    });
    const changes = onChange.mock.calls.length;
    view.rerender(pageTree(onChange));
    expect(onChange).toHaveBeenCalledTimes(changes);
    expect(mocks.getSheet).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('leave page'));
    expect(screen.getByTestId('page-context')).toHaveTextContent('null');
  });

  it.each(['', '   '])('clears the context when the next sheet has no part: %j', async fhincd => {
    mocks.getSheet.mockResolvedValueOnce({ sheet: buildSheet(), session: null })
      .mockResolvedValueOnce({ sheet: buildSheet(fhincd, 'sheet-2'), session: null });
    render(pageTree());
    await waitFor(() => expect(screen.getByTestId('page-context')).toHaveTextContent('FH001'));
    fireEvent.click(screen.getByText('next sheet'));
    await waitFor(() => expect(mocks.getSheet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('page-context')).toHaveTextContent('null'));
  });

  it('updates the context for the next part', async () => {
    mocks.getSheet.mockResolvedValueOnce({ sheet: buildSheet(), session: null })
      .mockResolvedValueOnce({ sheet: buildSheet('FH002', 'sheet-2'), session: null });
    render(pageTree());
    await waitFor(() => expect(screen.getByTestId('page-context')).toHaveTextContent('FH001'));
    fireEvent.click(screen.getByText('next sheet'));
    await waitFor(() => expect(screen.getByTestId('page-context')).toHaveTextContent('FH002'));
    expect(JSON.parse(screen.getByTestId('page-context').textContent!)).toEqual({
      path: '/kiosk/part-measurement/edit/sheet-2', entity: { kind: 'partNumber', value: 'FH002' },
    });
  });
});
