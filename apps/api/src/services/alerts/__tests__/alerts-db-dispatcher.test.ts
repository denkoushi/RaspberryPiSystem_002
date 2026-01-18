import { describe, expect, it } from 'vitest';
import { computeAlertFingerprint, computeBackoffSeconds, resolveDedupeWindowSeconds } from '../alerts-db-dispatcher.js';

describe('AlertsDbDispatcher (Phase2 follow-up) - helpers', () => {
  it('computeBackoffSeconds uses exponential backoff with cap', () => {
    expect(computeBackoffSeconds(60, 1)).toBe(60);
    expect(computeBackoffSeconds(60, 2)).toBe(120);
    expect(computeBackoffSeconds(60, 3)).toBe(240);
    // cap at 3600 seconds
    expect(computeBackoffSeconds(60, 20)).toBe(3600);
  });

  it('resolveDedupeWindowSeconds prefers routeKey override', () => {
    const cfg = { defaultWindowSeconds: 600, windowSecondsByRouteKey: { ops: 300 } };
    expect(resolveDedupeWindowSeconds(cfg, 'ops')).toBe(300);
    expect(resolveDedupeWindowSeconds(cfg, 'deploy')).toBe(600);
  });

  it('computeAlertFingerprint uses stored fingerprint when present', () => {
    const fp = computeAlertFingerprint(
      {
        id: 'a1',
        type: 't',
        severity: null,
        message: 'm',
        details: null,
        source: null,
        context: null,
        fingerprint: 'precomputed',
        timestamp: new Date(),
        acknowledged: false,
        acknowledgedAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
      } as any,
      'ops'
    );
    expect(fp).toBe('precomputed');
  });

  it('computeAlertFingerprint is deterministic when fingerprint is missing', () => {
    const alert = {
      id: 'a2',
      type: 'ansible-update-failed',
      severity: null,
      message: 'fail',
      details: { x: 1 },
      source: { host: 'pi5' },
      context: { branch: 'main' },
      fingerprint: null,
      timestamp: new Date('2026-01-01T00:00:00Z'),
      acknowledged: false,
      acknowledgedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    } as any;
    const fp1 = computeAlertFingerprint(alert, 'deploy');
    const fp2 = computeAlertFingerprint(alert, 'deploy');
    expect(fp1).toBe(fp2);
    expect(fp1).not.toBe('');
  });
});

