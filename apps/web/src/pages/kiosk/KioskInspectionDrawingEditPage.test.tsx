import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskInspectionDrawingEditPage } from './KioskInspectionDrawingEditPage';

import type { PartMeasurementSheetDto } from '../../features/part-measurement/types';

const mocks = vi.hoisted(() => ({ getSheet: vi.fn(), patchSheet: vi.fn(), finalizeSheet: vi.fn(), patchEvaluation: vi.fn(), finalizeEvaluation: vi.fn() }));
vi.mock('../../api/client', () => ({
  getResolvedClientKey: () => 'test-client',
  getPartMeasurementSheet: mocks.getSheet,
  patchPartMeasurementSheet: mocks.patchSheet,
  finalizePartMeasurementSheet: mocks.finalizeSheet,
  patchInspectionDrawingEvaluationSheet: mocks.patchEvaluation,
  finalizeInspectionDrawingEvaluationSheet: mocks.finalizeEvaluation,
}));
vi.mock('../../hooks/useNfcStream', () => ({ useNfcStream: () => null }));
vi.mock('../../features/part-measurement/usePartMeasurementDrawingBlobUrl', () => ({
  usePartMeasurementDrawingBlobUrl: () => ({ blobUrl: null, error: null }),
  resolveKioskDrawingDisplayWidth: () => 1000,
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

function buildDraftSheet(): PartMeasurementSheetDto {
  return {
    ...buildSheet(), status: 'DRAFT', quantity: 1,
    template: {
      id: 'template-1', fhincd: 'FH001', resourceCd: 'R001', processGroup: 'cutting',
      templateScope: 'three_key', candidateFhinmei: null, name: '測定', version: 1, isActive: true,
      selfInspectionMode: 'full', selfInspectionFixedCount: null, selfInspectionSampleSize: null,
      visualTemplateId: 'visual-1', visualTemplate: { id: 'visual-1', name: '図面', drawingImageRelativePath: '/drawing.png', isActive: true, createdAt: '', updatedAt: '' }, siblingGroupId: null, siblingGroup: null,
      items: [{
        id: 'item-1', sortOrder: 0, datumSurface: 'A', measurementPoint: 'B', measurementLabel: '寸法',
        displayMarker: null, unit: 'mm', allowNegative: false, decimalPlaces: 2,
        markerXRatio: '0.5', markerYRatio: '0.5', nominalValue: '10', lowerLimit: '9', upperLimit: '11',
      }],
    },
    results: [0].map(pieceIndex => ({ id: `result-${pieceIndex}`, pieceIndex, templateItemId: 'item-1', value: '10' })),
  };
}


function renderPage() {
  return render(<MemoryRouter initialEntries={['/kiosk/part-measurement/inspection/edit/sheet-1']}>
    <Routes><Route path="/kiosk/part-measurement/inspection/edit/:sheetId" element={<KioskInspectionDrawingEditPage />} /></Routes>
  </MemoryRouter>);
}

describe('KioskInspectionDrawingEditPage saving', () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.resetAllMocks();
    const sheet = buildDraftSheet();
    mocks.getSheet.mockResolvedValue({ sheet });
    mocks.patchSheet.mockResolvedValue({ sheet });
    mocks.finalizeSheet.mockResolvedValue({ sheet: { ...sheet, status: 'FINALIZED' } });
  });

  it.each([
    ['10.123', { response: { data: { message: '小数桁数は最大2桁です' } } }, '小数桁数は最大2桁です'],
    ['-1', { response: { data: { message: '負の値は入力できません' } } }, '負の値は入力できません'],
    ['11', new Error('network'), '確定に失敗しました。'],
  ])('stops finalization when saving %s fails', async (value, error, message) => {
    mocks.patchSheet.mockRejectedValue(error);
    renderPage();
    fireEvent.change(await screen.findByDisplayValue('10'), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: '確定' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(mocks.patchSheet).toHaveBeenCalledWith('sheet-1', { quantity: 1, results: [
      { pieceIndex: 0, templateItemId: 'item-1', value },
    ] }, 'test-client');
    expect(mocks.finalizeSheet).not.toHaveBeenCalled();
    expect(mocks.finalizeEvaluation).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '確定' })).toBeEnabled();
  });

  it.each([
    [{ response: { data: { message: '負の値は入力できません' } } }, '負の値は入力できません'],
    [new Error('network'), '保存に失敗しました。'],
  ])('shows autosave errors using the existing message area', async (error, message) => {
    mocks.patchSheet.mockRejectedValueOnce(error).mockResolvedValue({ sheet: buildDraftSheet() });
    renderPage();
    fireEvent.change(await screen.findByDisplayValue('10'), { target: { value: '-1' } });
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(mocks.finalizeSheet).not.toHaveBeenCalled();
    expect(mocks.patchSheet).toHaveBeenCalledWith('sheet-1', { quantity: 1, results: [
      { pieceIndex: 0, templateItemId: 'item-1', value: '-1' },
    ] }, 'test-client');
    fireEvent.change(screen.getByDisplayValue('-1'), { target: { value: '10.12' } });
    await waitFor(() => expect(screen.queryByText(message)).not.toBeInTheDocument());
    expect(mocks.patchSheet).toHaveBeenCalledTimes(2);
  });


  it('does not autosave without edits, during finalization, or after finalization', async () => {
    vi.useFakeTimers();
    let finishFinalize!: (value: { sheet: PartMeasurementSheetDto }) => void;
    mocks.finalizeSheet.mockImplementation(() => new Promise(resolve => { finishFinalize = resolve; }));
    await act(async () => { renderPage(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1800); });
    expect(mocks.patchSheet).not.toHaveBeenCalled();
    fireEvent.change(screen.getByDisplayValue('10'), { target: { value: '10.12' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1800); });
    expect(mocks.patchSheet).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByDisplayValue('10.12'), { target: { value: '10.5' } });
    fireEvent.click(screen.getByRole('button', { name: '確定' }));
    await act(async () => {});
    fireEvent.change(screen.getByDisplayValue('10.5'), { target: { value: '11' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1800); });
    expect(mocks.patchSheet).toHaveBeenCalledTimes(2);
    await act(async () => { finishFinalize({ sheet: { ...buildDraftSheet(), status: 'FINALIZED' } }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1800); });
    expect(mocks.patchSheet).toHaveBeenCalledTimes(2);
    expect(screen.getByText('確定しました。')).toBeInTheDocument();
  });

  it('preserves a finalization error when a later autosave succeeds', async () => {
    mocks.finalizeSheet.mockRejectedValue({ response: { data: { message: '確定できません' } } });
    renderPage();
    await screen.findByDisplayValue('10');
    fireEvent.click(screen.getByRole('button', { name: '確定' }));
    expect(await screen.findByText('確定できません')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('10'), { target: { value: '10.12' } });
    await waitFor(() => expect(mocks.patchSheet).toHaveBeenCalledTimes(2));
    expect(screen.getByText('確定できません')).toBeInTheDocument();
  });

  it('awaits saving the last input before finalizing', async () => {
    let finishSave!: (value: { sheet: PartMeasurementSheetDto }) => void;
    mocks.patchSheet.mockImplementation(() => new Promise(resolve => { finishSave = resolve; }));
    renderPage();
    fireEvent.change(await screen.findByDisplayValue('10'), { target: { value: '10.5' } });
    fireEvent.click(screen.getByRole('button', { name: '確定' }));
    await waitFor(() => expect(mocks.patchSheet).toHaveBeenCalledOnce());
    expect(mocks.finalizeSheet).not.toHaveBeenCalled();
    finishSave({ sheet: buildDraftSheet() });
    await waitFor(() => expect(mocks.finalizeSheet).toHaveBeenCalledWith('sheet-1', 'test-client'));
    expect(await screen.findByText('確定しました。')).toBeInTheDocument();
  });

  it('waits for an in-flight autosave before saving and finalizing', async () => {
    vi.useFakeTimers();
    const draft = buildDraftSheet();
    mocks.getSheet.mockResolvedValue({ sheet: draft, session: null });
    let finishAutosave!: (value: { sheet: PartMeasurementSheetDto }) => void;
    mocks.patchSheet.mockImplementationOnce(() => new Promise(resolve => { finishAutosave = resolve; }))
      .mockResolvedValue({ sheet: draft, session: null });
    mocks.finalizeSheet.mockResolvedValue({ sheet: { ...draft, status: 'FINALIZED' }, session: null });
    await act(async () => { renderPage(); });
    fireEvent.change(screen.getByDisplayValue('10'), { target: { value: '10.12' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(mocks.patchSheet).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '確定' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1800); });
    expect(mocks.patchSheet).toHaveBeenCalledOnce();
    expect(mocks.finalizeSheet).not.toHaveBeenCalled();
    await act(async () => { finishAutosave({ sheet: draft }); });
    expect(mocks.patchSheet).toHaveBeenCalledTimes(2);
    expect(mocks.finalizeSheet).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(1800); });
    expect(mocks.patchSheet).toHaveBeenCalledTimes(2);
    expect(screen.getByText('確定しました。')).toBeInTheDocument();
  });

});
