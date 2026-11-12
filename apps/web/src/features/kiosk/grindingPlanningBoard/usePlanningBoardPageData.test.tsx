import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { usePlanningBoardPageData } from './usePlanningBoardPageData';

import type { GrindingPlanningBoardItem, GrindingPlanningBoardResponse } from '@raspi-system/shared-types';

const piece: GrindingPlanningBoardItem = {
  itemId: 'piece:a', kind: 'piece', parentItemId: 'parent', pieceId: 'a', pieceSetVersion: 1,
  itemRevision: 'rev-a', version: 1, sourceRowId: 'row', fseiban: 'S1', fhincd: 'H1',
  fhinmei: '部品', machineName: null, productNo: 'P1', processOrder: '10',
  originalResourceCd: '305', effectiveResourceCd: '305', originalDueDate: null, effectiveDueDate: null,
  originalRank: null, alternateRank: null, plannedQuantity: 5, requiredMinutes: 100,
  lslhSurface: false, requiredMinutesKnown: true, isCompleted: false,
  progress: { completed: 0, total: 1, quantityKnown: true }
};
const board = (): GrindingPlanningBoardResponse => ({
  siteKey: 'site', category: 'grinding', view: 'resource', sourceRevision: 'revision', boardVersion: 1,
  items: [piece], registeredFseibans: ['S1'], uncheckedFseibans: [], seibanOrder: ['S1'], resources: ['305'],
  resourceCategories: { '305': 'grinding' }, load: [], unknownRequiredMinutesCount: 0,
  seibanProgress: { S1: { completed: 0, total: 1 } }, snapshotId: 'initial', nextCursor: null
});
function setup() {
  const response = board();
  const props = { response: response as GrindingPlanningBoardResponse | undefined, scope: 'grinding:both:resource:incomplete:excel' };
  const hook = renderHook(({ response, scope }: typeof props) => usePlanningBoardPageData(response, scope), { initialProps: props });
  return { ...hook, props, response };
}

describe('usePlanningBoardPageData', () => {
  it('retains all drawing references while response metadata advances', () => {
    const h = setup();
    const previous = h.result.current.data!;
    const response = { ...structuredClone(h.response), snapshotId: 'new', nextCursor: 'next-page' };
    h.rerender({ ...h.props, response });
    expect(h.result.current.response).toBe(response);
    expect(h.result.current.response?.snapshotId).toBe('new');
    expect(h.result.current.data).toBe(previous);
    expect(h.result.current.data?.items).toBe(previous.items);
    expect(h.result.current.data?.registeredFseibans).toBe(previous.registeredFseibans);
    expect(h.result.current.data?.resources).toBe(previous.resources);
    expect(h.result.current.data?.resourceCategories).toBe(previous.resourceCategories);
    expect(h.result.current.data).not.toHaveProperty('snapshotId');
    expect(h.result.current.data).not.toHaveProperty('nextCursor');
  });

  it.each(['items', 'resources', 'registeredFseibans', 'sourceRevision'] as const)('updates references when %s changes', (field) => {
    const h = setup();
    const previous = h.result.current.data;
    const response = structuredClone(h.response);
    if (field === 'items') response.items[0]!.requiredMinutes += 1;
    else if (field === 'sourceRevision') response.sourceRevision = 'changed';
    else response[field].push('new');
    h.rerender({ ...h.props, response });
    expect(h.result.current.data).not.toBe(previous);
    expect(h.result.current.data?.[field]).toEqual(response[field]);
  });

  it('removes disappeared pieces', () => {
    const h = setup();
    const previous = h.result.current.data;
    h.rerender({ ...h.props, response: { ...h.response, snapshotId: 'removed', items: [] } });
    expect(h.result.current.data).not.toBe(previous);
    expect(h.result.current.data?.items).toEqual([]);
  });

  it.each(['cutting', 'general', 'seiban', 'all', 'scaw'])('updates on a scope switch to %s even with equal placeholder content', (scope) => {
    const h = setup();
    const previous = h.result.current.data;
    h.rerender({ ...h.props, scope });
    expect(h.result.current.data).not.toBe(previous);
    expect(h.result.current.data).toEqual(previous);
  });

  it('clears content when the response disappears', () => {
    const h = setup();
    h.rerender({ ...h.props, response: undefined });
    expect(h.result.current.data).toBeUndefined();
    expect(h.result.current.response).toBeUndefined();
    h.rerender(h.props);
    expect(h.result.current.data?.items).toEqual([piece]);
  });
});
