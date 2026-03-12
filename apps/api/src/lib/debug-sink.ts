import { logger } from './logger.js';

type DebugEventPayload = {
  location: string;
  message: string;
  data?: unknown;
  timestamp?: number;
  sessionId?: string;
  runId?: string;
  hypothesisId?: string;
};

const DEBUG_SINK_ENABLED = process.env.DEBUG_SINK_ENABLED === 'true';
const DEBUG_SINK_URL = process.env.DEBUG_SINK_URL ?? 'http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8';
const DEBUG_SINK_TIMEOUT_MS = Number.parseInt(process.env.DEBUG_SINK_TIMEOUT_MS ?? '1500', 10);

/**
 * 調査用イベントを外部シンクへ送る。
 * 既定は無効（no-op）にして、本番挙動への影響を防ぐ。
 */
export async function emitDebugEvent(payload: DebugEventPayload): Promise<void> {
  if (!DEBUG_SINK_ENABLED) {
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEBUG_SINK_TIMEOUT_MS);

  try {
    await fetch(DEBUG_SINK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        timestamp: payload.timestamp ?? Date.now(),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    logger?.debug(
      {
        err: error,
        location: payload.location,
      },
      '[DebugSink] Failed to emit debug event'
    );
  } finally {
    clearTimeout(timeout);
  }
}
