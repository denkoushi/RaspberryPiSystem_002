import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getInspectionDrawingPlacementProposals,
  postInspectionDrawingPlacementDecisions
} from '../../../api/domains/part-measurement-placement';

import { drawingPointToTemplateItemInput } from './markerNumbering';
import { useInspectionDrawingPlacementProposals } from './useInspectionDrawingPlacementProposals';

import type { InspectionDrawingPoint } from './types';
import type { DrawingPlacementResponse } from '../../../api/domains/part-measurement-placement';
import type { ReactNode } from 'react';

vi.mock('../../../api/domains/part-measurement-placement', () => ({
  getInspectionDrawingPlacementProposals: vi.fn(),
  postInspectionDrawingPlacementDecisions: vi.fn()
}));

const first = {
  id: 'proposal-1', sortOrder: 0, measurementLabel: '内径', measurementPoint: '内径（裏面）',
  nominalValue: 56, lowerLimit: 55.98, upperLimit: 56.03, decimalPlaces: 3,
  depthMode: 'measured' as const, valueKind: 'numeric' as const, markerXRatio: 0.3, markerYRatio: 0.4,
  dimensionText: 'Φ56 h7'
};
const response: DrawingPlacementResponse = {
  status: 'ready', sourceDrawingName: '兄弟図面.png',
  proposals: [first, { ...first, id: 'proposal-2', sortOrder: 1, nominalValue: 20 }],
  unplaced: [{ ...first, id: 'unplaced-1', nominalValue: 30, reason: 'no-candidate' }]
};

function setup(enabled = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onPlaceMode = vi.fn();
  const onSelectPoint = vi.fn();
  const saveApi = vi.fn().mockResolvedValue({});
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(({ id, editable, processGroup }) => {
    const [points, setPoints] = useState<InspectionDrawingPoint[]>([]);
    const placement = useInspectionDrawingPlacementProposals({
      visualTemplateId: id, processGroup, enabled: editable, clientKey: 'kiosk-key',
      points, onPointsChange: setPoints, onPlaceMode, onSelectPoint
    });
    const save = async () => {
      // Same save contract as the page: only points, then notify after success.
      const items = points.map((point, index) => drawingPointToTemplateItemInput(point, index));
      await saveApi({ items });
      placement.flushApprovals(points);
    };
    return { placement, points, setPoints, save };
  }, { wrapper, initialProps: { id: 'visual-1', editable: enabled, processGroup: 'cutting' as 'cutting' | 'grinding' } });
  return { ...hook, saveApi, onPlaceMode, onSelectPoint };
}

describe('useInspectionDrawingPlacementProposals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getInspectionDrawingPlacementProposals).mockResolvedValue(response);
    vi.mocked(postInspectionDrawingPlacementDecisions).mockResolvedValue({ updated: 1 });
  });

  it('never puts unapproved proposals in the save payload and only posts approvals after save success', async () => {
    const { result, saveApi } = setup();
    await waitFor(() => expect(result.current.placement.proposals).toHaveLength(2));
    await act(() => result.current.save());
    expect(saveApi).toHaveBeenLastCalledWith({ items: [] });
    expect(postInspectionDrawingPlacementDecisions).not.toHaveBeenCalled();

    act(() => result.current.placement.approve(first));
    expect(result.current.points).toHaveLength(1);
    expect(result.current.placement.proposals).toHaveLength(1);
    expect(postInspectionDrawingPlacementDecisions).not.toHaveBeenCalled();
    saveApi.mockRejectedValueOnce(new Error('save failed'));
    await act(async () => {
      await expect(result.current.save()).rejects.toThrow('save failed');
    });
    expect(postInspectionDrawingPlacementDecisions).not.toHaveBeenCalled();
    expect(saveApi.mock.lastCall?.[0].items).toHaveLength(1);

    let finishSave!: () => void;
    saveApi.mockReturnValueOnce(new Promise<void>((resolve) => { finishSave = resolve; }));
    let saving!: Promise<void>;
    act(() => { saving = result.current.save(); });
    expect(postInspectionDrawingPlacementDecisions).not.toHaveBeenCalled();
    await act(async () => { finishSave(); await saving; });
    expect(postInspectionDrawingPlacementDecisions).toHaveBeenCalledWith(
      'visual-1', { approvedIds: [first.id], approvedPositions: [{ id: first.id, xRatio: 0.3, yRatio: 0.4 }] }, 'kiosk-key'
    );
    await act(() => result.current.save());
    expect(postInspectionDrawingPlacementDecisions).toHaveBeenCalledTimes(1);
  });

  it('approves all in order, selects the last point, and skips deleted approved points at save', async () => {
    const { result, onSelectPoint } = setup();
    await waitFor(() => expect(result.current.placement.proposals).toHaveLength(2));
    act(() => result.current.placement.approveAll());
    expect(result.current.points.map((point) => point.markerNo)).toEqual([1, 2]);
    expect(result.current.points.map((point) => point.nominalRaw)).toEqual(['56', '20']);
    expect(onSelectPoint).toHaveBeenLastCalledWith(result.current.points[1].id);
    act(() => result.current.setPoints((points) => points.slice(1)));
    await act(() => result.current.save());
    expect(postInspectionDrawingPlacementDecisions).toHaveBeenCalledWith(
      'visual-1', { approvedIds: ['proposal-2'], approvedPositions: [{ id: 'proposal-2', xRatio: 0.3, yRatio: 0.4 }] }, 'kiosk-key'
    );
  });

  it.each(['single', 'all'])('uses moved proposal positions for %s approval and sends final saved point positions', async (kind) => {
    const { result } = setup();
    await waitFor(() => expect(result.current.placement.proposals).toHaveLength(2));
    act(() => result.current.placement.moveProposal(first.id, { xRatio: 0.6, yRatio: 0.7 }));
    expect(result.current.placement.proposals[0]).toMatchObject({ markerXRatio: 0.6, markerYRatio: 0.7 });
    expect(result.current.placement.proposals[1]).toMatchObject({ markerXRatio: 0.3, markerYRatio: 0.4 });
    expect(first).toMatchObject({ markerXRatio: 0.3, markerYRatio: 0.4 });
    act(() => kind === 'single' ? result.current.placement.approve(first) : result.current.placement.approveAll());
    expect(result.current.points[0]).toMatchObject({ xRatio: 0.6, yRatio: 0.7 });
    act(() => result.current.setPoints((points) => points.map((point, index) =>
      index === 0 ? { ...point, xRatio: 0.8, yRatio: 0.9 } : point)));
    await act(() => result.current.save());
    expect(postInspectionDrawingPlacementDecisions).toHaveBeenCalledWith('visual-1', {
      approvedIds: kind === 'single' ? [first.id] : [first.id, 'proposal-2'],
      approvedPositions: [
        { id: first.id, xRatio: 0.8, yRatio: 0.9 },
        ...(kind === 'all' ? [{ id: 'proposal-2', xRatio: 0.3, yRatio: 0.4 }] : [])
      ]
    }, 'kiosk-key');
  });

  it('resets moved positions when the drawing changes', async () => {
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.placement.proposals).toHaveLength(2));
    act(() => result.current.placement.moveProposal(first.id, { xRatio: 0.8, yRatio: 0.9 }));
    rerender({ id: 'visual-2', editable: true, processGroup: 'cutting' });
    await waitFor(() => expect(result.current.placement.proposals).toHaveLength(2));
    expect(result.current.placement.proposals[0]).toMatchObject({ markerXRatio: 0.3, markerYRatio: 0.4 });
  });

  it('rejects immediately and does not let a failed decision affect the UI or save', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(postInspectionDrawingPlacementDecisions).mockRejectedValue(new Error('offline'));
    const { result } = setup();
    await waitFor(() => expect(result.current.placement.proposals).toHaveLength(2));
    act(() => result.current.placement.reject(first));
    expect(result.current.placement.proposals).toHaveLength(1);
    expect(postInspectionDrawingPlacementDecisions).toHaveBeenCalledWith(
      'visual-1', { rejectedIds: [first.id] }, 'kiosk-key'
    );
    act(() => result.current.placement.approveAll());
    await act(async () => { await expect(result.current.save()).resolves.toBeUndefined(); });
    expect(warn).toHaveBeenCalledTimes(2);
    await act(() => result.current.save());
    expect(postInspectionDrawingPlacementDecisions).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('arms an unplaced row, fills a normal point at the tap, and disarms after one placement', async () => {
    const { result, onPlaceMode } = setup();
    await waitFor(() => expect(result.current.placement.unplaced).toHaveLength(1));
    act(() => result.current.placement.arm(response.unplaced[0]));
    expect(onPlaceMode).toHaveBeenCalledOnce();
    expect(result.current.placement.armedId).toBe('unplaced-1');
    act(() => expect(result.current.placement.placeArmed(0.7, 0.8)).toBe(true));
    expect(result.current.points[0]).toMatchObject({
      name: '内径', nominalRaw: '30', depthMode: 'measured', valueKind: 'numeric',
      decimalPlaces: 3, xRatio: 0.7, yRatio: 0.8
    });
    expect(result.current.placement.armedId).toBeNull();
    expect(result.current.placement.unplaced).toEqual([]);
    act(() => expect(result.current.placement.placeArmed(0.2, 0.3)).toBe(false));
    await act(() => result.current.save());
    expect(postInspectionDrawingPlacementDecisions).not.toHaveBeenCalled();
  });

  it('does not fetch in disabled modes; fetches once despite edits and mode toggles', async () => {
    const { result, rerender } = setup(false);
    expect(getInspectionDrawingPlacementProposals).not.toHaveBeenCalled();
    rerender({ id: 'visual-1', editable: true, processGroup: 'cutting' });
    await waitFor(() => expect(result.current.placement.proposals).toHaveLength(2));
    act(() => result.current.placement.selectProposal(first.id));
    act(() => result.current.placement.arm(response.unplaced[0]));
    rerender({ id: 'visual-1', editable: false, processGroup: 'cutting' });
    expect(result.current.placement.proposals).toEqual([]);
    expect(result.current.placement.armedId).toBeNull();
    rerender({ id: 'visual-1', editable: true, processGroup: 'cutting' });
    expect(getInspectionDrawingPlacementProposals).toHaveBeenCalledTimes(1);
    expect(getInspectionDrawingPlacementProposals).toHaveBeenCalledWith('visual-1', 'cutting', 'kiosk-key');
  });

  it.each(['map-pending', 'no-sibling'] as const)('hides %s responses', async (status) => {
    vi.mocked(getInspectionDrawingPlacementProposals).mockResolvedValue({ ...response, status });
    const { result } = setup();
    await waitFor(() => expect(getInspectionDrawingPlacementProposals).toHaveBeenCalledOnce());
    expect(result.current.placement.proposals).toEqual([]);
    expect(result.current.placement.unplaced).toEqual([]);
  });

  it('refetches and resets pending decisions, selection, tabs and armed items when process changes', async () => {
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.placement.proposals).toHaveLength(2));
    act(() => result.current.placement.approve(first));
    act(() => result.current.placement.selectProposal('proposal-2'));
    act(() => result.current.placement.arm(response.unplaced[0]));
    rerender({ id: 'visual-1', editable: true, processGroup: 'grinding' });
    expect(result.current.placement.selectedProposalId).toBeNull();
    expect(result.current.placement.armedId).toBeNull();
    expect(result.current.placement.tab).toBe('proposals');
    await waitFor(() => expect(getInspectionDrawingPlacementProposals).toHaveBeenCalledWith('visual-1', 'grinding', 'kiosk-key'));
    await act(() => result.current.save());
    expect(postInspectionDrawingPlacementDecisions).not.toHaveBeenCalled();
    act(() => result.current.setPoints([]));
    await waitFor(() => expect(result.current.placement.proposals).toHaveLength(2));
  });

  it('does not carry pending decisions or stale data to another drawing', async () => {
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.placement.proposals).toHaveLength(2));
    act(() => result.current.placement.approve(first));
    vi.mocked(getInspectionDrawingPlacementProposals).mockResolvedValue({
      status: 'no-sibling', proposals: [], unplaced: [], sourceDrawingName: null
    });
    rerender({ id: 'visual-2', editable: true, processGroup: 'cutting' });
    expect(result.current.placement.proposals).toEqual([]);
    await act(() => result.current.save());
    expect(postInspectionDrawingPlacementDecisions).not.toHaveBeenCalled();
  });
});
