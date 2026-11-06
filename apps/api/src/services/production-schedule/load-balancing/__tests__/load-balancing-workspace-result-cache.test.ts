import { describe, expect, it, vi } from 'vitest';

import { readLoadBalancingWorkspaceResultWithCache, serializeLoadBalancingWorkspace } from '../load-balancing-workspace-result-cache.js';
import type { LoadBalancingWorkspaceResult } from '../load-balancing-workspace.types.js';

function workspace(): LoadBalancingWorkspaceResult {
  return { siteKey: 'site', today: '2026-11-06', fromMonth: '2026-11', toMonth: '2026-11', months: ['2026-11'],
    resources: [], rows: [], unallocatedRows: [], transferRules: [] };
}

describe('workspace result cache', () => {
  it('reuses assembly and serialization only for the same source and settings', () => {
    const source = { queryRows: [], machineNames: {} };
    const assemble = vi.fn(workspace);
    const read = (settingsKey: string) => readLoadBalancingWorkspaceResultWithCache({ source, settingsKey, assemble });
    const first = read('settings-1');
    expect(read('settings-1')).toBe(first);
    expect(assemble).toHaveBeenCalledTimes(1);
    const stringify = vi.spyOn(JSON, 'stringify');
    try {
      const body = serializeLoadBalancingWorkspace(first);
      expect(serializeLoadBalancingWorkspace(first)).toBe(body);
      expect(stringify).toHaveBeenCalledTimes(1);
      expect(JSON.parse(body)).toEqual(first);
    } finally {
      stringify.mockRestore();
    }
    expect(read('settings-2')).not.toBe(first);
    expect(assemble).toHaveBeenCalledTimes(2);
    const otherSource = { queryRows: [], machineNames: {} };
    expect(readLoadBalancingWorkspaceResultWithCache({ source: otherSource, settingsKey: 'settings-2', assemble })).not.toBe(first);
    expect(assemble).toHaveBeenCalledTimes(3);
  });
});
