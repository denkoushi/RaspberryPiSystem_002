import { describe, expect, it } from 'vitest';

import { toolsQueryKeys } from './tools';

describe('toolsQueryKeys', () => {
  it('preserves invalidation prefixes', () => {
    expect(toolsQueryKeys.machinesAll).toEqual(['machines']);
    expect(toolsQueryKeys.uninspectedMachinesAll).toEqual(['machines-uninspected']);
    expect(toolsQueryKeys.loansAll).toEqual(['loans']);
  });

  it('preserves machine parameters including omitted and empty parameters', () => {
    const machines = { search: 'machine-1', operatingStatus: 'active' };
    expect(toolsQueryKeys.machines(machines)).toEqual(['machines', machines]);
    expect(toolsQueryKeys.machines({})).toEqual(['machines', {}]);
    expect(toolsQueryKeys.machines()).toEqual(['machines', undefined]);
    const uninspected = { csvDashboardId: 'dashboard-1', date: '2026-10-17' };
    expect(toolsQueryKeys.uninspectedMachines(uninspected)).toEqual(['machines-uninspected', uninspected]);
    expect(toolsQueryKeys.uninspectedMachines({})).toEqual(['machines-uninspected', {}]);
    expect(toolsQueryKeys.uninspectedMachines()).toEqual(['machines-uninspected', undefined]);
  });

  it('preserves loan argument order and undefined elements', () => {
    expect(toolsQueryKeys.loans('client-1', 'key-1')).toEqual(['loans', 'client-1', 'key-1']);
    expect(toolsQueryKeys.loans()).toEqual(['loans', undefined, undefined]);
    expect(toolsQueryKeys.loans('client-1')).toEqual(['loans', 'client-1', undefined]);
    expect(toolsQueryKeys.loans(undefined, 'key-1')).toEqual(['loans', undefined, 'key-1']);
    expect(toolsQueryKeys.loans('', '')).toEqual(['loans', '', '']);
  });

  it('preserves invalidation prefixes', () => {
    expect(toolsQueryKeys.departmentsAll).toEqual(['departments']);
    expect(toolsQueryKeys.employeesAll).toEqual(['employees']);
    expect(toolsQueryKeys.itemsAll).toEqual(['items']);
    expect(toolsQueryKeys.photoLabelReviewsAll).toEqual(['photo-label-reviews']);
  });

  it('preserves photoLabelReviews values and arity', () => {
    expect(toolsQueryKeys.photoLabelReviews(50)).toEqual(['photo-label-reviews', 50]);
    expect(toolsQueryKeys.photoLabelReviews(0)).toEqual(['photo-label-reviews', 0]);
    expect(toolsQueryKeys.photoLabelReviews(1)).toEqual(['photo-label-reviews', 1]);
  });

  it('preserves photoSimilarCandidates values and arity', () => {
    expect(toolsQueryKeys.photoSimilarCandidates('loan-1')).toEqual(['photo-similar-candidates', 'loan-1']);
    expect(toolsQueryKeys.photoSimilarCandidates('')).toEqual(['photo-similar-candidates', '']);
  });

  it('preserves transactions values and arity', () => {
    expect(toolsQueryKeys.transactions(2, { employeeId: 'employee-1', startDate: '2026-10-01', endDate: '2026-10-19', itemId: 'item-1', clientId: 'client-1' })).toEqual(['transactions', 2, { employeeId: 'employee-1', startDate: '2026-10-01', endDate: '2026-10-19', itemId: 'item-1', clientId: 'client-1' }]);
    expect(toolsQueryKeys.transactions(1)).toEqual(['transactions', 1, undefined]);
    expect(toolsQueryKeys.transactions(1, undefined)).toEqual(['transactions', 1, undefined]);
    expect(toolsQueryKeys.transactions(0, {})).toEqual(['transactions', 0, {}]);
    expect(toolsQueryKeys.transactions(1, { employeeId: '', startDate: '', endDate: '', itemId: '', clientId: '' })).toEqual(['transactions', 1, { employeeId: '', startDate: '', endDate: '', itemId: '', clientId: '' }]);
  });

  it('preserves unifiedItems values and arity', () => {
    expect(toolsQueryKeys.unifiedItems({ search: 'tool', category: 'TOOLS', itemStatus: 'AVAILABLE' })).toEqual(['unified-items', { search: 'tool', category: 'TOOLS', itemStatus: 'AVAILABLE' }]);
    expect(toolsQueryKeys.unifiedItems({})).toEqual(['unified-items', {}]);
    expect(toolsQueryKeys.unifiedItems(undefined)).toEqual(['unified-items', undefined]);
    expect(toolsQueryKeys.unifiedItems()).toEqual(['unified-items', undefined]);
    expect(toolsQueryKeys.unifiedItems({ search: '' })).toEqual(['unified-items', { search: '' }]);
  });
});
