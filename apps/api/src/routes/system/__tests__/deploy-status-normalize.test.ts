import { describe, expect, it } from 'vitest';
import { normalizeDeployStatusResponse } from '../deploy-status.js';

describe('normalizeDeployStatusResponse', () => {
  it('returns metadata only for the matching maintenance client', () => {
    const raw = {
      version: 2,
      kioskByClient: {
        kiosk1: {
          maintenance: true,
          runId: 'run-1',
          phase: 'preparing',
          startedAt: '2026-07-11T00:00:00Z'
        },
        kiosk2: { maintenance: false, runId: 'run-1' }
      }
    };
    expect(normalizeDeployStatusResponse(raw, 'kiosk1')).toEqual({
      isMaintenance: true,
      runId: 'run-1',
      phase: 'preparing',
      startedAt: '2026-07-11T00:00:00Z'
    });
    expect(normalizeDeployStatusResponse(raw, 'kiosk2')).toEqual({ isMaintenance: false });
    expect(normalizeDeployStatusResponse(raw, null)).toEqual({ isMaintenance: false });
  });

  it('ignores unknown phases while preserving maintenance state', () => {
    expect(normalizeDeployStatusResponse({ kioskByClient: { kiosk1: { maintenance: true, phase: 'future' } } }, 'kiosk1'))
      .toEqual({ isMaintenance: true });
  });
});
