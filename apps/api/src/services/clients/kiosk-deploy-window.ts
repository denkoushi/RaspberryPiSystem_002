import { readFile } from 'node:fs/promises';
import { deployStatusFilePath, DEPLOY_STATUS_ENTRY_TTL_MS } from '../../lib/deploy-status-file.js';

import { KIOSK_ERROR_WINDOW_MS } from './client-telemetry-alert-policy.js';

export const KIOSK_DEPLOY_GRACE_MS = 5 * 60 * 1000;
const CACHE_MS = 5_000;
const ACTIVE_PHASES = new Set(['notice', 'preparing', 'deploying']);
const windowEnds = new Map<string, number>();
let cachedAt = -Infinity;
let cachedPath: string | null = null;
let entries: Record<string, unknown> = {};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function refreshKioskDeployWindows(now: Date): Promise<void> {
  const time = now.getTime();
  const path = deployStatusFilePath();
  if (path !== cachedPath || time - cachedAt >= CACHE_MS || time < cachedAt) {
    if (path !== cachedPath) windowEnds.clear();
    try {
      const raw: unknown = JSON.parse(await readFile(path, 'utf-8'));
      entries = isRecord(raw) && isRecord(raw.kioskByClient) ? raw.kioskByClient : {};
    } catch {
      // Keep remembered windows: an unreadable file must not end a grace period early.
      entries = {};
    }
    cachedAt = time;
    cachedPath = path;
  }
  for (const [clientId, value] of Object.entries(entries)) {
    if (!isRecord(value)) continue;
    if (value.phase === 'failed') {
      windowEnds.delete(clientId);
      continue;
    }
    if (typeof value.phase !== 'string' || !ACTIVE_PHASES.has(value.phase)) continue;
    const start = value.phase === 'notice' ? value.noticeStartedAt : value.startedAt;
    const startMs = typeof start === 'string' ? Date.parse(start) : NaN;
    if (!Number.isFinite(startMs) || time - startMs > DEPLOY_STATUS_ENTRY_TTL_MS) continue;
    windowEnds.set(clientId, time + KIOSK_DEPLOY_GRACE_MS);
  }
  // Retain ended windows only while they can affect the error count query.
  for (const [clientId, end] of windowEnds) {
    if (time - end > KIOSK_ERROR_WINDOW_MS) windowEnds.delete(clientId);
  }
}

export async function deployWindowEndedAt(clientId: string, now: Date): Promise<Date | null> {
  await refreshKioskDeployWindows(now);
  const end = windowEnds.get(clientId);
  return end === undefined ? null : new Date(end);
}
