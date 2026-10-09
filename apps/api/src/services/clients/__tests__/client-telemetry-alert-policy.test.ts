import { AlertSeverity } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  resolveTelemetryAlertDecision,
  kioskErrorCountSince,
  sanitizeClientTelemetryLogEntry
} from '../client-telemetry-alert-policy.js';

describe('client telemetry alert policy', () => {
  it('preserves the storage-health alert contract', () => {
    const decision = resolveTelemetryAlertDecision('pi4-1', {
      level: 'ERROR',
      message: 'Root filesystem is mounted read-only',
      context: {
        category: 'storage_health',
        signal: 'root_filesystem_read_only',
        observedAt: '2026-07-29T00:00:00Z'
      }
    });
    expect(decision).toMatchObject({
      type: 'storage-health-root_filesystem_read_only',
      severity: AlertSeverity.ERROR,
      dedupeAcrossAcknowledgedAlerts: false
    });
  });

  it('creates a sanitized terminal-health decision', () => {
    const decision = resolveTelemetryAlertDecision('assembly-01', {
      level: 'WARN',
      message: 'ignored raw message',
      context: {
        category: 'terminal_agent_health',
        action: 'unhealthy',
        agent: 'nfc',
        signal: 'queue',
        episodeId: '3d594650-3436-4a9f-bf51-2524200ea34e',
        observedAt: '2026-07-29T00:00:00Z',
        consecutiveFailures: 2,
        queueSize: 3,
        uid: 'must-not-leak',
        lastEvent: { uid: 'must-not-leak' },
        token: 'must-not-leak',
        url: 'http://127.0.0.1:7071'
      }
    });
    expect(decision).toMatchObject({
      type: 'terminal-agent-health-nfc-queue',
      severity: AlertSeverity.WARNING,
      dedupeAcrossAcknowledgedAlerts: true,
      details: {
        clientId: 'assembly-01',
        agent: 'nfc',
        signal: 'queue',
        queueSize: 3,
        consecutiveFailures: 2
      }
    });
    const serialized = JSON.stringify(decision);
    expect(serialized).not.toContain('must-not-leak');
    expect(serialized).not.toContain('127.0.0.1');
  });

  it('sanitizes terminal health before ClientLog persistence', () => {
    const sanitized = sanitizeClientTelemetryLogEntry({
      level: 'ERROR',
      message: 'raw uid=012345 token=secret',
      context: {
        category: 'terminal_agent_health',
        action: 'unhealthy',
        agent: 'nfc',
        signal: 'reader',
        episodeId: '3d594650-3436-4a9f-bf51-2524200ea34e',
        observedAt: '2026-07-29T00:00:00Z',
        consecutiveFailures: 2,
        uid: '012345',
        token: 'secret',
        url: 'http://127.0.0.1:7071'
      }
    });
    expect(sanitized).toEqual({
      level: 'ERROR',
      message: 'Terminal agent unhealthy: nfc/reader',
      context: {
        category: 'terminal_agent_health',
        action: 'unhealthy',
        agent: 'nfc',
        signal: 'reader',
        severity: 'ERROR',
        episodeId: '3d594650-3436-4a9f-bf51-2524200ea34e',
        observedAt: '2026-07-29T00:00:00Z',
        consecutiveFailures: 2
      }
    });
  });

  it('drops malformed terminal health instead of storing raw context', () => {
    expect(
      sanitizeClientTelemetryLogEntry({
        level: 'ERROR',
        message: 'malformed',
        context: {
          category: 'terminal_agent_health',
          uid: 'must-not-store'
        }
      })
    ).toBeNull();
  });

  it('rejects first failure, recovery, and unknown agent', () => {
    const base = {
      category: 'terminal_agent_health',
      action: 'unhealthy',
      agent: 'nfc',
      signal: 'reader',
      episodeId: '3d594650-3436-4a9f-bf51-2524200ea34e',
      observedAt: '2026-07-29T00:00:00Z',
      consecutiveFailures: 2
    };
    expect(
      resolveTelemetryAlertDecision('pi4', {
        level: 'INFO',
        message: 'recovered',
        context: { ...base, action: 'recovery' }
      })
    ).toBeNull();
    expect(
      resolveTelemetryAlertDecision('pi4', {
        level: 'ERROR',
        message: 'first',
        context: { ...base, consecutiveFailures: 1 }
      })
    ).toBeNull();
    expect(
      resolveTelemetryAlertDecision('pi4', {
        level: 'ERROR',
        message: 'bad',
        context: { ...base, agent: 'unknown' }
      })
    ).toBeNull();
  });

  it('uses the episode id in the terminal-health fingerprint', () => {
    const build = (episodeId: string) =>
      resolveTelemetryAlertDecision('pi4', {
        level: 'ERROR',
        message: 'reader disconnected',
        context: {
          category: 'terminal_agent_health',
          action: 'unhealthy',
          agent: 'nfc',
          signal: 'reader',
          episodeId,
          observedAt: '2026-07-29T00:00:00Z',
          consecutiveFailures: 2
        }
      });
    expect(build('3d594650-3436-4a9f-bf51-2524200ea34e')?.fingerprint).not.toBe(
      build('217b7ada-788b-47e1-ab92-426c46ee6d18')?.fingerprint
    );
  });
});

describe('kiosk UI alert policy', () => {
  const context = { category: 'kiosk_ui_error', kind: 'api_network', count: 2, route: '/kiosk/borrow', clientDeviceName: '組立端末', clientDeviceId: 'device-1', incidentCode: 'A7K2Q9', requestId: 'req-123' };
  const now = new Date('2026-10-08T00:01:00Z');
  it('alerts immediately for render crashes, even a single occurrence', () => {
    expect(resolveTelemetryAlertDecision('pi4', { level: 'ERROR', message: 'crash', context: { ...context, kind: 'render_crash' } }, 1, now)?.severity).toBe(AlertSeverity.ERROR);
  });
  it('requires three ERROR occurrences and ignores WARN', () => {
    const entry = { level: 'ERROR' as const, message: 'failed', context };
    expect(resolveTelemetryAlertDecision('pi4', entry, 2, now)).toBeNull();
    const decision = resolveTelemetryAlertDecision('pi4', entry, 3, now);
    expect(decision?.message).toContain('組立端末');
    expect(decision?.message).toContain('/kiosk/borrow');
    expect(decision?.message).toContain('件数 3');
    expect(decision?.message).toContain('A7K2Q9');
    expect(decision?.message).toContain('req-123');
    expect(resolveTelemetryAlertDecision('pi4', { ...entry, level: 'WARN' }, 10, now)).toBeNull();
  });
  it('uses one fingerprint per device in a 30 minute bucket across kinds', () => {
    const build = (kind: string, date: Date) => resolveTelemetryAlertDecision('pi4', { level: 'ERROR', message: 'failed', context: { ...context, kind } }, 3, date)!;
    expect(build('render_crash', now).fingerprint).toBe(build('api_5xx', new Date('2026-10-08T00:29:00Z')).fingerprint);
    expect(build('render_crash', now).fingerprint).not.toBe(build('render_crash', new Date('2026-10-08T00:31:00Z')).fingerprint);
    expect(build('render_crash', now).dedupeAcrossAcknowledgedAlerts).toBe(true);
  });
  it('treats a crash the kiosk reloaded away as an ordinary error', () => {
    const entry = { level: 'ERROR' as const, message: 'chunk', context: { ...context, kind: 'render_crash', recoveryDecision: 'reload' } };
    expect(resolveTelemetryAlertDecision('pi4', entry, 1, now)).toBeNull();
    expect(resolveTelemetryAlertDecision('pi4', entry, 3, now)).not.toBeNull();
  });
  it('does not count errors stored within three minutes of API start', () => {
    const startedAt = new Date('2026-10-08T00:00:00Z');
    expect(kioskErrorCountSince(new Date('2026-10-08T00:02:59Z'), startedAt)).toBeNull();
    expect(kioskErrorCountSince(new Date('2026-10-08T00:05:00Z'), startedAt)).toEqual(new Date('2026-10-08T00:03:00Z'));
    expect(kioskErrorCountSince(new Date('2026-10-08T01:00:00Z'), startedAt)).toEqual(new Date('2026-10-08T00:50:00Z'));
  });
});


describe('network telemetry is recording only', () => {
  it.each(['network_health', 'kiosk_net_stats'])('never alerts for %s even at ERROR severity', (category) => {
    expect(resolveTelemetryAlertDecision('pi4', { level: 'ERROR', message: 'network failure', context: {
      category, signalDbm: -90, statusPostOk: false, statusPostMs: 99999, failures: 500, count: 500
    } }, 500)).toBeNull();
  });
});
