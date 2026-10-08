import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HermesPageContextProvider, useHermesPageContext } from '../../components/hermes/HermesPageContext';

import { KioskPartMeasurementEditPage } from './KioskPartMeasurementEditPage';

import type { HermesPageContext } from '../../api/domains/assembly';
import type { PartMeasurementSheetDto } from '../../features/part-measurement/types';

const mocks = vi.hoisted(() => ({ getSheet: vi.fn() }));
vi.mock('../../api/client', () => ({
  getResolvedClientKey: () => 'test-client',
  getPartMeasurementSheet: mocks.getSheet,
  cancelPartMeasurementSheet: vi.fn(),
  downloadPartMeasurementSheetCsv: vi.fn(),
  finalizePartMeasurementSheet: vi.fn(),
  patchPartMeasurementSheet: vi.fn(),
  transferPartMeasurementEditLock: vi.fn(),
}));
vi.mock('../../hooks/useNfcStream', () => ({ useNfcStream: () => null }));
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
        <Route path="/kiosk/part-measurement/edit/:sheetId" element={<KioskPartMeasurementEditPage />} />
      </Routes>
    </HermesPageContextProvider>
  </MemoryRouter>;
}

describe('KioskPartMeasurementEditPage Hermes context', () => {
  beforeEach(() => mocks.getSheet.mockReset().mockResolvedValue({ sheet: buildSheet(), session: null }));

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
