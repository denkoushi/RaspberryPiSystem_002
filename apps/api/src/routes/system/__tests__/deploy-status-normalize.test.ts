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

  it('returns a non-blocking pre-notice only for the matching notice client', () => {
    const raw = {
      version: 2,
      kioskByClient: {
        kiosk1: {
          maintenance: false,
          runId: 'run-notice',
          phase: 'notice',
          noticeDurationSeconds: 60,
          scheduledAt: '2026-07-13T00:01:00.000Z'
        },
        kiosk2: { maintenance: false, runId: 'run-notice', phase: 'notice' }
      }
    };
    expect(normalizeDeployStatusResponse(raw, 'kiosk1')).toEqual({
      isMaintenance: false,
      runId: 'run-notice',
      preNotice: { scheduledAt: '2026-07-13T00:01:00.000Z' }
    });
    expect(normalizeDeployStatusResponse(raw, 'kiosk2')).toEqual({
      isMaintenance: false,
      runId: 'run-notice',
      preNotice: {}
    });
  });
});
