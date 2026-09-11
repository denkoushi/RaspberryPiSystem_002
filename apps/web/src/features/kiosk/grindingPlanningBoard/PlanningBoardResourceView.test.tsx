import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlanningBoardResourceView } from './PlanningBoardResourceView';

import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;

  constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

function item(itemId: string, resourceCd: string): GrindingPlanningBoardItem {
  return {
    itemId,
    kind: 'row',
    itemRevision: 'revision-' + itemId,
    version: 2,
    sourceRowId: 'source-' + itemId,
    fseiban: '26-1041',
    fhincd: 'PART-' + itemId,
    fhinmei: '部品' + itemId,
    machineName: '研削機',
    productNo: 'PRODUCT-' + itemId,
    processOrder: '10',
    originalResourceCd: resourceCd,
    effectiveResourceCd: null,
    originalDueDate: '2026-09-12',
    effectiveDueDate: null,
    originalRank: null,
    alternateRank: null,
    plannedQuantity: 1,
    requiredMinutes: 5,
    requiredMinutesKnown: true,
    isCompleted: false,
    progress: { completed: 0, total: 1, quantityKnown: false }
  };
}

function renderView(onClick = vi.fn(), onDrop = vi.fn()) {
  const sourceItem = item('a', '305');
  const targetItem = item('b', '584');
  render(
    <PlanningBoardResourceView
      items={[sourceItem, targetItem]}
      seibanOrder={['26-1041']}
      resources={['305', '584']}
      resourceNameMap={{}}
      allocation="alternate"
      selectedItemIds={new Set()}
      onToggleItem={vi.fn()}
      onResourceClick={onClick}
      onResourceDrop={onDrop}
    />
  );
  return { sourceItem, targetItem, onClick, onDrop };
}

describe('PlanningBoardResourceView resource chip drag', () => {
  beforeEach(() => {
    vi.stubGlobal('PointerEvent', TestPointerEvent);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('閾値未満は既存の資源CDクリックとして扱う', () => {
    const { onClick, onDrop } = renderView();
    const source = screen.getByRole('button', { name: '資源CD 305を変更' });
    const sourcePane = source.closest('[data-planning-board-resource-pane]')!;

    fireEvent.pointerDown(source, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(sourcePane, { pointerId: 1, clientX: 19, clientY: 10 });
    fireEvent.pointerUp(sourcePane, { pointerId: 1, clientX: 19, clientY: 10 });
    fireEvent.click(source);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('閾値超過後はpaneへ一度だけdropし、直後のclickを抑止して次操作を許可する', () => {
    const { onClick, onDrop, sourceItem } = renderView();
    const source = screen.getByRole('button', { name: '資源CD 305を変更' });
    const sourcePane = source.closest('[data-planning-board-resource-pane]')!;
    const targetPane = screen.getByTestId('planning-board-resource-view').querySelector('[data-resource-code="584"]');
    expect(targetPane).not.toBeNull();
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [targetPane!])
    });

    fireEvent.pointerDown(source, { pointerId: 2, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(sourcePane, { pointerId: 2, clientX: 21, clientY: 10 });
    fireEvent.pointerMove(sourcePane, { pointerId: 2, clientX: 40, clientY: 10 });
    fireEvent.pointerUp(sourcePane, { pointerId: 2, clientX: 40, clientY: 10 });
    fireEvent.click(source);

    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith(sourceItem, '584');
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.pointerDown(source, { pointerId: 2, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(sourcePane, { pointerId: 2, clientX: 10, clientY: 10 });
    fireEvent.click(source);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('pointermoveをrAFにまとめ、pane外のゴーストをcleanupする', () => {
    const { onDrop } = renderView();
    const source = screen.getByRole('button', { name: '資源CD 305を変更' });
    const sourcePane = source.closest('[data-planning-board-resource-pane]')!;
    const frames: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [])
    });

    fireEvent.pointerDown(source, { pointerId: 3, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(sourcePane, { pointerId: 3, clientX: 21, clientY: 10 });
    fireEvent.pointerMove(sourcePane, { pointerId: 3, clientX: 31, clientY: 10 });

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    fireEvent.pointerCancel(sourcePane, { pointerId: 3, clientX: 31, clientY: 10 });

    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[aria-hidden="true"]')).not.toBeInTheDocument();
    expect(onDrop).not.toHaveBeenCalled();
  });
});
