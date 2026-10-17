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
});
