import { AlertSeverity } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  resolveTelemetryAlertDecision,
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
