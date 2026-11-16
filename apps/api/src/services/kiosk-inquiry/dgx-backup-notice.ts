import { z } from 'zod';

import { env } from '../../config/env.js';
import { createTimeoutSignal } from '../../lib/timeout-signal.js';
import { getInferenceRuntime } from '../inference/inference-runtime.js';

import { deliverSystemNotice } from './system-notice.service.js';

const backupStatusSchema = z.object({
  contractVersion: z.literal(1),
  lastResult: z.enum(['success', 'failed', 'unknown']),
  recordedAt: z.string().datetime({ offset: true }).nullable(),
});

export async function evaluateDgxBackupNotice(now = new Date()): Promise<void> {
  if (!env.DGX_BACKUP_NOTICE_ENABLED) return;
  const config = getInferenceRuntime().getAdminLocalLlmRuntimeConfig();
  if (!config.baseUrl || !config.sharedToken) return;

  const timeout = createTimeoutSignal(5000);
  let payload: unknown;
  try {
    const response = await fetch(new URL('/system/backup-status', config.baseUrl), {
      method: 'GET',
      headers: { 'X-LLM-Token': config.sharedToken },
      signal: timeout.signal,
    });
    if (!response.ok) return;
    payload = await response.json();
  } finally {
    timeout.cleanup();
  }
  const result = backupStatusSchema.safeParse(payload);
  if (!result.success || result.data.lastResult === 'unknown') return;
  await deliverSystemNotice({
    key: 'dgx-backup:failed',
    title: 'DGX バックアップ',
    body: '夜間のバックアップが失敗しました。',
    state: result.data.lastResult === 'failed' ? 'open' : 'recovered',
  }, now);
}
