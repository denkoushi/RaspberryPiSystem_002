import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LeaderOrderSplitModal } from '../LeaderOrderSplitModal';

import type { LeaderBoardRow } from '../types';

const fetchSplitsMock = vi.hoisted(() => vi.fn());
const replaceSplitsMock = vi.hoisted(() => vi.fn());
const deleteSplitsMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../api/client', () => ({
  fetchKioskProductionScheduleOrderSplits: fetchSplitsMock,
  replaceKioskProductionScheduleOrderSplits: replaceSplitsMock,
  deleteKioskProductionScheduleOrderSplits: deleteSplitsMock
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type SplitListResponse = {
  parentCsvDashboardRowId: string;
  plannedQuantity: number;
  splits: Array<{
    id: string;
    displayItemId: string;
    parentCsvDashboardRowId: string;
    splitNo: number;
    splitQuantity: number;
    dueDate: string | null;
    plannedStartDate: string | null;
    plannedEndDate: string | null;
    orderNumber: number | null;
  }>;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeRow(id: string, plannedQuantity: number): LeaderBoardRow {
  return {
    id,
    sourceRowId: id,
    seibanJoinKey: `SEIBAN-${id}`,
    resourceCd: '305',
    dueDate: null,
    plannedEndDate: null,
    displayDue: null,
    fseiban: `SEIBAN-${id}`,
    productNo: id,
    fkojun: '10',
    fhincd: `PART-${id}`,
    fhinmei: `部品 ${id}`,
    customerName: '',
    machineName: '',
    machineTypeCode: '',
    plannedQuantity,
    processingOrder: null,
    isCompleted: false,
    requiredMinutes: 0,
    machineRequiredMinutes: 0,
    laborRequiredMinutes: 0,
    note: null,
    hasSelfInspectionDrawing: false,
    selfInspectionTemplateId: null,
    selfInspectionStatus: null,
    selfInspectionEntryPath: null,
    splitId: null,
    splitNo: null,
    splitQuantity: null,
    isSplit: false
  };
}

describe('LeaderOrderSplitModal component', () => {
  beforeEach(() => {
    fetchSplitsMock.mockReset();
    replaceSplitsMock.mockReset();
    deleteSplitsMock.mockReset();
    replaceSplitsMock.mockResolvedValue({ success: true, splits: [] });
  });

  it('行切替中は古いGET応答を破棄し、読み込み完了前に保存しない', async () => {
    const rowA = makeRow('11111111-1111-4111-8111-111111111111', 5);
    const rowB = makeRow('22222222-2222-4222-8222-222222222222', 4);
    const loadA = deferred<SplitListResponse>();
    const loadB = deferred<SplitListResponse>();

    fetchSplitsMock.mockImplementation((sourceRowId: string) => {
      if (sourceRowId === rowA.sourceRowId) return loadA.promise;
      if (sourceRowId === rowB.sourceRowId) return loadB.promise;
      throw new Error(`unexpected row ${sourceRowId}`);
    });

    const onClose = vi.fn();
    const onSaved = vi.fn();
    const view = render(
      <LeaderOrderSplitModal open row={rowA} onClose={onClose} onSaved={onSaved} />
    );

    view.rerender(<LeaderOrderSplitModal open row={rowB} onClose={onClose} onSaved={onSaved} />);
    const saveButton = screen.getByRole('button', { name: '保存' });
    expect(saveButton).toBeDisabled();
    fireEvent.click(saveButton);
    expect(replaceSplitsMock).not.toHaveBeenCalled();

    await act(async () => {
      loadA.resolve({
        parentCsvDashboardRowId: rowA.sourceRowId,
        plannedQuantity: 5,
        splits: [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            displayItemId: 'split:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            parentCsvDashboardRowId: rowA.sourceRowId,
            splitNo: 1,
            splitQuantity: 5,
            dueDate: null,
            plannedStartDate: null,
            plannedEndDate: null,
            orderNumber: 1
          }
        ]
      });
    });
    expect(saveButton).toBeDisabled();
    expect(screen.getByText(/指示数: —/)).toBeInTheDocument();

    await act(async () => {
      loadB.resolve({
        parentCsvDashboardRowId: rowB.sourceRowId,
        plannedQuantity: 4,
        splits: [
          {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            displayItemId: 'split:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            parentCsvDashboardRowId: rowB.sourceRowId,
            splitNo: 1,
            splitQuantity: 4,
            dueDate: null,
            plannedStartDate: null,
            plannedEndDate: null,
            orderNumber: null
          }
        ]
      });
    });

    await waitFor(() => expect(screen.getByText(/指示数: 4/)).toBeInTheDocument());
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(replaceSplitsMock).toHaveBeenCalledTimes(1));
    expect(replaceSplitsMock).toHaveBeenCalledWith(rowB.sourceRowId, {
      resourceCd: rowB.resourceCd,
      items: [
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          splitNo: 1,
          splitQuantity: 4,
          dueDate: null,
          plannedStartDate: null,
          plannedEndDate: null,
          orderNumber: null
        }
      ]
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
