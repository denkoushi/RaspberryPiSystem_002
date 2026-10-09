import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeDeployStatusResponse } from '../deploy-status.js';

describe('normalizeDeployStatusResponse', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns metadata only for the matching maintenance client', () => {
    const raw = {
      version: 2,
      kioskByClient: {
        kiosk1: {
          maintenance: true,
          runId: 'run-1',
          phase: 'preparing',
          startedAt: new Date().toISOString()
        },
        kiosk2: { maintenance: false, runId: 'run-1' }
      }
    };
    expect(normalizeDeployStatusResponse(raw, 'kiosk1')).toEqual({
      isMaintenance: true,
      runId: 'run-1',
      phase: 'preparing',
      startedAt: raw.kioskByClient.kiosk1.startedAt
    });
    expect(normalizeDeployStatusResponse(raw, 'kiosk2')).toEqual({ isMaintenance: false });
    expect(normalizeDeployStatusResponse(raw, null)).toEqual({ isMaintenance: false });
  });

  it('ignores unknown phases while preserving maintenance state', () => {
    expect(normalizeDeployStatusResponse({ kioskByClient: { kiosk1: { maintenance: true, phase: 'future' } } }, 'kiosk1'))
      .toEqual({ isMaintenance: true });
  });

  it('returns verifying and its immutable desired release SHA backward-compatibly', () => {
    const desiredReleaseSha = 'a'.repeat(40);
    const verificationId = '1'.repeat(32);
    expect(normalizeDeployStatusResponse({
      kioskByClient: {
        kiosk1: {
          maintenance: true,
          runId: 'run-verifying',
          phase: 'verifying',
          desiredReleaseSha,
          verificationMode: 'release',
          verificationId
        }
      }
    }, 'kiosk1')).toEqual({
      isMaintenance: true,
      runId: 'run-verifying',
      phase: 'verifying',
      desiredReleaseSha,
      verificationCycle: 'release',
      verificationId
    });
  });

  it('exposes a rollback verification as a distinct ready cycle', () => {
    const desiredReleaseSha = 'b'.repeat(40);
    const verificationId = '2'.repeat(32);
    expect(normalizeDeployStatusResponse({
      kioskByClient: {
        kiosk1: {
          maintenance: true,
          runId: 'run-verifying',
          phase: 'verifying',
          desiredReleaseSha,
          verificationMode: 'rollback',
          verificationId
        }
      }
    }, 'kiosk1')).toEqual({
      isMaintenance: true,
      runId: 'run-verifying',
      phase: 'verifying',
      desiredReleaseSha,
      verificationCycle: 'rollback',
      verificationId
    });
  });

  it('does not expose a malformed desired release SHA', () => {
    expect(normalizeDeployStatusResponse({
      kioskByClient: {
        kiosk1: {
          maintenance: true,
          phase: 'verifying',
          desiredReleaseSha: 'A'.repeat(40)
        }
      }
    }, 'kiosk1')).toEqual({ isMaintenance: true, phase: 'verifying' });
  });

  it('does not expose stale desired release identity outside verification', () => {
    expect(normalizeDeployStatusResponse({
      kioskByClient: {
        kiosk1: {
          maintenance: true,
          phase: 'failed',
          desiredReleaseSha: 'a'.repeat(40)
        }
      }
    }, 'kiosk1')).toEqual({ isMaintenance: true, phase: 'failed' });
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

describe('deploy-status expiry', () => {
  const now = Date.parse('2026-10-09T12:00:00Z');
  afterEach(() => vi.restoreAllMocks());

  it.each(['notice', 'preparing', 'deploying', 'failed'])('expires %s after 30 minutes without rewriting state', (phase) => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const start = new Date(now - 30 * 60 * 1000 - 1).toISOString();
    const entry = { phase, maintenance: phase !== 'notice', runId: 'run',
      startedAt: start, noticeStartedAt: start };
    const before = { ...entry };
    const raw = { kioskByClient: { kiosk1: entry } };
    expect(normalizeDeployStatusResponse(raw, 'kiosk1')).toEqual({ isMaintenance: false });
    expect(raw.kioskByClient.kiosk1).toEqual(before);
  });

  it('uses noticeStartedAt for notices and startedAt for maintenance, regardless of updatedAt', () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const stale = new Date(now - 31 * 60 * 1000).toISOString();
    const fresh = new Date(now).toISOString();
    for (const entry of [
      { phase: 'notice', maintenance: false, noticeStartedAt: stale, startedAt: fresh, updatedAt: fresh },
      { phase: 'deploying', maintenance: true, startedAt: stale, noticeStartedAt: fresh, updatedAt: fresh }
    ]) {
      expect(normalizeDeployStatusResponse({ kioskByClient: { kiosk1: entry } }, 'kiosk1'))
        .toEqual({ isMaintenance: false });
    }
  });

  it.each(['notice', 'preparing', 'deploying', 'failed'])('preserves %s at the 30-minute boundary', (phase) => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const start = new Date(now - 30 * 60 * 1000).toISOString();
    const raw = { kioskByClient: { kiosk1: { phase, maintenance: phase !== 'notice',
      startedAt: start, noticeStartedAt: start } } };
    const response = normalizeDeployStatusResponse(raw, 'kiosk1');
    if (phase === 'notice') expect(response.preNotice).toEqual({});
    else expect(response.isMaintenance).toBe(true);
  });

  it.each([undefined, 'invalid'])('preserves entries with missing/invalid start %s', (start) => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    for (const phase of ['notice', 'preparing', 'deploying', 'failed']) {
      const raw = { kioskByClient: { kiosk1: { phase, maintenance: phase !== 'notice',
        startedAt: start, noticeStartedAt: start } } };
      const response = normalizeDeployStatusResponse(raw, 'kiosk1');
      if (phase === 'notice') expect(response.preNotice).toEqual({});
      else expect(response.isMaintenance).toBe(true);
    }
  });

  it.each(['verifying', 'ready', 'canary-hold', 'future'])('does not expire %s', (phase) => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    expect(normalizeDeployStatusResponse({ kioskByClient: { kiosk1: {
      phase, maintenance: true, startedAt: new Date(0).toISOString()
    } } }, 'kiosk1').isMaintenance).toBe(true);
  });
});
