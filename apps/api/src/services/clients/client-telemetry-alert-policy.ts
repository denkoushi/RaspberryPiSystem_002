import crypto from 'crypto';
import { AlertSeverity } from '@prisma/client';

export type ClientTelemetryLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
export type ClientTelemetryLogEntry = {
  level: ClientTelemetryLogLevel;
  message: string;
  context?: Record<string, unknown>;
};

export interface TelemetryAlertDecision {
  type: string;
  severity: AlertSeverity;
  message: string;
  details: Record<string, unknown>;
  source: Record<string, unknown>;
  fingerprint: string;
  timestamp: Date;
  dedupeAcrossAcknowledgedAlerts: boolean;
}

const STORAGE_CATEGORY = 'storage_health';
const TERMINAL_CATEGORY = 'terminal_agent_health';
const SIMPLE_SIGNAL = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const EPISODE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_AGENTS = new Set(['nfc', 'barcode', 'torque']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function timestamp(value: unknown): Date {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function terminalContext(
  entry: ClientTelemetryLogEntry,
  context: Record<string, unknown>
): Record<string, unknown> | null {
  const action = context.action;
  const agent = context.agent;
  const signal = context.signal;
  const episodeId = context.episodeId;
  const observedAt = context.observedAt;
  const consecutiveFailures = context.consecutiveFailures;
  const validLevel =
    (action === 'unhealthy' && (entry.level === 'WARN' || entry.level === 'ERROR')) ||
    (action === 'recovery' && entry.level === 'INFO');
  if (
    !validLevel ||
    typeof agent !== 'string' ||
    !TERMINAL_AGENTS.has(agent) ||
    typeof signal !== 'string' ||
    !SIMPLE_SIGNAL.test(signal) ||
    typeof episodeId !== 'string' ||
    !EPISODE_ID.test(episodeId) ||
    typeof observedAt !== 'string' ||
    Number.isNaN(new Date(observedAt).getTime()) ||
    typeof consecutiveFailures !== 'number' ||
    !Number.isInteger(consecutiveFailures) ||
    consecutiveFailures < 2
  ) {
    return null;
  }
  const safe: Record<string, unknown> = {
    category: TERMINAL_CATEGORY,
    action,
    agent,
    signal,
    severity: entry.level,
    episodeId,
    observedAt,
    consecutiveFailures
  };
  if (
    signal === 'queue' &&
    typeof context.queueSize === 'number' &&
    Number.isInteger(context.queueSize) &&
    context.queueSize >= 0
  ) {
    safe.queueSize = context.queueSize;
  }
  return safe;
}

export function sanitizeClientTelemetryLogEntry(
  entry: ClientTelemetryLogEntry
): ClientTelemetryLogEntry | null {
  if (!isRecord(entry.context) || entry.context.category !== TERMINAL_CATEGORY) {
    return entry;
  }
  const context = terminalContext(entry, entry.context);
  if (!context) return null;
  const action = context.action;
  const agent = String(context.agent);
  const signal = String(context.signal);
  return {
    level: entry.level,
    message:
      action === 'recovery'
        ? `Terminal agent recovered: ${agent}/${signal}`
        : `Terminal agent unhealthy: ${agent}/${signal}`,
    context
  };
}

function fingerprint(parts: readonly string[]): string {
  return crypto.createHash('sha256').update(parts.join(':')).digest('hex');
}

function storageDecision(
  clientId: string,
  entry: ClientTelemetryLogEntry,
  context: Record<string, unknown>
): TelemetryAlertDecision | null {
  if (entry.level !== 'WARN' && entry.level !== 'ERROR') return null;
  const rawSignal = context.signal;
  const signal =
    typeof rawSignal === 'string' && rawSignal.trim() ? rawSignal.trim() : 'unknown_signal';
  const type = `storage-health-${signal}`;
  return {
    type,
    severity: entry.level === 'ERROR' ? AlertSeverity.ERROR : AlertSeverity.WARNING,
    message: `SDカードヘルス異常: ${clientId}: ${entry.message.slice(0, 500)}`,
    details: {
      clientId,
      level: entry.level,
      signal,
      logMessage: entry.message,
      logContext: context
    },
    source: { service: 'status-agent', clientId, category: STORAGE_CATEGORY },
    fingerprint: fingerprint([type, clientId, signal]),
    timestamp: timestamp(context.observedAt),
    dedupeAcrossAcknowledgedAlerts: false
  };
}

function terminalDecision(
  clientId: string,
  entry: ClientTelemetryLogEntry,
  context: Record<string, unknown>
): TelemetryAlertDecision | null {
  const safeContext = terminalContext(entry, context);
  if (!safeContext || safeContext.action !== 'unhealthy') return null;
  const agent = String(safeContext.agent);
  const signal = String(safeContext.signal);
  const episodeId = String(safeContext.episodeId);
  const consecutiveFailures = Number(safeContext.consecutiveFailures);
  const type = `terminal-agent-health-${agent}-${signal}`;
  const safeDetails: Record<string, unknown> = {
    clientId,
    level: entry.level,
    agent,
    signal,
    episodeId,
    consecutiveFailures
  };
  if (
    signal === 'queue' &&
    typeof safeContext.queueSize === 'number' &&
    Number.isInteger(safeContext.queueSize) &&
    safeContext.queueSize >= 0
  ) {
    safeDetails.queueSize = safeContext.queueSize;
  }
  return {
    type,
    severity: entry.level === 'ERROR' ? AlertSeverity.ERROR : AlertSeverity.WARNING,
    message: `端末周辺機器異常: ${clientId}: ${agent}/${signal}`,
    details: safeDetails,
    source: { service: 'status-agent', clientId, category: TERMINAL_CATEGORY },
    fingerprint: fingerprint([type, clientId, agent, signal, episodeId]),
    timestamp: timestamp(safeContext.observedAt),
    dedupeAcrossAcknowledgedAlerts: true
  };
}

export function resolveTelemetryAlertDecision(
  clientId: string,
  entry: ClientTelemetryLogEntry
): TelemetryAlertDecision | null {
  if (!isRecord(entry.context)) return null;
  if (entry.context.category === STORAGE_CATEGORY) {
    return storageDecision(clientId, entry, entry.context);
  }
  if (entry.context.category === TERMINAL_CATEGORY) {
    return terminalDecision(clientId, entry, entry.context);
  }
  return null;
}
