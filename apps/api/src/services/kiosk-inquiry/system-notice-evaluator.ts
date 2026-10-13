import { runExclusiveSchedulerTick } from '../../lib/exclusive-scheduler-tick.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { isMonitoredClient, loadHeartbeatAlertConfig } from '../clients/client-heartbeat-alert-policy.js';

import { terminalNoticeLabel } from './system-notice-sources.js';
import { deliverSystemNotice, resolveInactiveFileNotices, resolveUnmonitoredTerminalNotices } from './system-notice.service.js';

export const SYSTEM_NOTICE_EVALUATION_MS = 5 * 60 * 1000;
export const TERMINAL_STALE_MS = 15 * 60 * 1000;
export const TERMINAL_INACTIVE_MS = 14 * 24 * 60 * 60 * 1000;
export const TERMINAL_DISK_PERCENT = 90;
export const TERMINAL_TEMPERATURE_C = 80;

export async function evaluateSystemNotices(now = new Date()): Promise<void> {
  const config = loadHeartbeatAlertConfig();
  await resolveUnmonitoredTerminalNotices(now, config);
  const statuses = await prisma.clientStatus.findMany({ where: { lastSeen: { gt: new Date(now.getTime() - TERMINAL_INACTIVE_MS) } } });
  for (const status of statuses) {
    if (!isMonitoredClient(status.clientId, config)) continue;
    try {
      const age = now.getTime() - status.lastSeen.getTime();
      if (age >= TERMINAL_INACTIVE_MS) continue;
      const label = await terminalNoticeLabel(status.clientId);
      const conditions = [
        { signal: 'stale', title: '通信', body: '端末からの連絡が途絶えています。', open: age >= TERMINAL_STALE_MS },
        { signal: 'disk', title: '空き容量', body: `保存領域の ${Math.round(status.diskUsage)}% を使っています。`, open: status.diskUsage >= TERMINAL_DISK_PERCENT },
        ...(status.temperature === null ? [] : [{ signal: 'temperature', title: '温度', body: `端末の温度が ${Math.round(status.temperature)}°C です。`, open: status.temperature >= TERMINAL_TEMPERATURE_C }])
      ];
      for (const condition of conditions) {
        await deliverSystemNotice({ key: `status:${status.clientId}:${condition.signal}`, title: `${label} ${condition.title}`,
          body: condition.body, state: condition.open ? 'open' : 'recovered' }, now);
      }
    } catch (err) {
      logger.warn({ err, clientId: status.clientId }, '[SystemNotice] Evaluation failed');
    }
  }
  await resolveInactiveFileNotices(now);
}

class SystemNoticeEvaluator {
  private timer: NodeJS.Timeout | null = null;
  private readonly tickExclusive = { locked: false };
  private running: Promise<void> | null = null;

  start(): void {
    if (process.env.NODE_ENV === 'test' || this.timer) return;
    const tick = () => {
      this.running = runExclusiveSchedulerTick(this.tickExclusive, logger, 'SystemNoticeEvaluator', () => evaluateSystemNotices())
        .catch(err => { logger.warn({ err }, '[SystemNotice] Scheduled evaluation failed'); });
    };
    tick();
    this.timer = setInterval(() => { if (!this.tickExclusive.locked) tick(); }, SYSTEM_NOTICE_EVALUATION_MS);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }
}

const evaluator = new SystemNoticeEvaluator();
export function getSystemNoticeEvaluator() { return evaluator; }
