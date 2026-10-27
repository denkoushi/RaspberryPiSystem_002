import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { isMonitoredClient, loadHeartbeatAlertConfig } from '../clients/client-heartbeat-alert-policy.js';
import { KIOSK_ALERT_COOLDOWN_MS } from '../clients/client-telemetry-alert-policy.js';

export const SYSTEM_NOTICE_REPEAT_MS = 24 * 60 * 60 * 1000;
export const FILE_NOTICE_EXPIRY_MS = 48 * 60 * 60 * 1000;
export const KIOSK_NOTICE_QUIET_MS = KIOSK_ALERT_COOLDOWN_MS;
export const FILE_NOTICE_PREFIX = 'file:';
export type SystemNotice = { key: string; title: string; body: string; state: 'open' | 'recovered'; repeatMs?: number };

async function lockNotice(tx: Prisma.TransactionClient, key: string) {
  // Transaction-scoped, shared by all API processes; the partial unique index is a second guard.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
}

export async function deliverSystemNotice(notice: SystemNotice, now = new Date()): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockNotice(tx, notice.key);
    const thread = await tx.kioskInquiryThread.findFirst({
      where: { kind: 'SYSTEM_NOTICE', noticeKey: notice.key, noticeResolvedAt: null },
      include: { messages: { where: { side: 'SYSTEM' }, orderBy: { createdAt: 'desc' }, take: 1 } }
    });
    if (!thread) {
      if (notice.state === 'recovered') return;
      await tx.kioskInquiryThread.create({ data: {
        kind: 'SYSTEM_NOTICE', noticeKey: notice.key, noticeTitle: notice.title,
        page: '/kiosk', receiverUnread: true, lastMessageAt: now,
        messages: { create: { side: 'SYSTEM', body: notice.body, createdAt: now } }
      } });
      return;
    }
    if (notice.state === 'open' && thread.messages[0]
      && now.getTime() - thread.messages[0].createdAt.getTime() < (notice.repeatMs ?? SYSTEM_NOTICE_REPEAT_MS)) {
      // Keep the terminal label current (renamed device, changed wording) without marking unread.
      if (thread.noticeTitle !== notice.title) {
        await tx.kioskInquiryThread.update({ where: { id: thread.id }, data: { noticeTitle: notice.title } });
      }
      return;
    }
    await tx.kioskInquiryThread.update({ where: { id: thread.id }, data: {
      receiverUnread: true, lastMessageAt: now,
      ...(notice.state === 'recovered' ? { noticeResolvedAt: now } : {}),
      messages: { create: { side: 'SYSTEM', body: notice.state === 'recovered' ? '復旧しました。' : notice.body, createdAt: now } }
    } });
  });
}

export async function resolveInactiveFileNotices(now = new Date(), type?: string): Promise<void> {
  const cutoff = new Date(now.getTime() - FILE_NOTICE_EXPIRY_MS);
  const threads = await prisma.kioskInquiryThread.findMany({
    where: { kind: 'SYSTEM_NOTICE', noticeKey: type ? `${FILE_NOTICE_PREFIX}${type}` : { startsWith: FILE_NOTICE_PREFIX }, noticeResolvedAt: null },
    select: { id: true, noticeKey: true }
  });
  for (const thread of threads) {
    const key = thread.noticeKey!;
    await prisma.$transaction(async (tx) => {
      await lockNotice(tx, key);
      const recent = await tx.alert.findFirst({
        where: { type: key.slice(FILE_NOTICE_PREFIX.length), timestamp: { gt: cutoff } }, select: { id: true }
      });
      if (!recent) {
        // Silence is not an observed recovery: no message and no change to unread or list ordering.
        await tx.kioskInquiryThread.updateMany({
          where: { id: thread.id, noticeResolvedAt: null }, data: { noticeResolvedAt: now }
        });
      }
    });
  }
}

export async function resolveQuietKioskUiErrorNotices(now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - KIOSK_NOTICE_QUIET_MS);
  const threads = await prisma.kioskInquiryThread.findMany({
    where: { kind: 'SYSTEM_NOTICE', noticeResolvedAt: null },
    select: { id: true, noticeKey: true }
  });
  for (const thread of threads) {
    const key = thread.noticeKey;
    if (!key) continue;
    let parts: unknown;
    try {
      parts = JSON.parse(key);
    } catch {
      continue;
    }
    if (!Array.isArray(parts) || parts.length !== 3 || parts[0] !== 'kiosk_ui_error'
      || typeof parts[1] !== 'string' || !parts[1] || typeof parts[2] !== 'string' || !parts[2]) continue;
    const [, clientId, deviceId] = parts;
    await prisma.$transaction(async (tx) => {
      await lockNotice(tx, key);
      const recent = await tx.clientLog.findFirst({
        where: {
          ...(deviceId === clientId ? { clientId } : {}),
          level: 'ERROR', createdAt: { gte: cutoff },
          AND: [
            { context: { path: ['category'], equals: 'kiosk_ui_error' } },
            ...(deviceId === clientId ? [] : [{ context: { path: ['clientDeviceId'], equals: deviceId } }])
          ]
        }, select: { id: true }
      });
      if (!recent) {
        await tx.kioskInquiryThread.updateMany({
          where: { id: thread.id, noticeResolvedAt: null }, data: { noticeResolvedAt: now }
        });
      }
    });
  }
}

export async function resolveUnmonitoredTerminalNotices(now = new Date(), config = loadHeartbeatAlertConfig()): Promise<void> {
  const threads = await prisma.kioskInquiryThread.findMany({
    where: { kind: 'SYSTEM_NOTICE', noticeResolvedAt: null },
    select: { id: true, noticeKey: true }
  });
  for (const thread of threads) {
    const key = thread.noticeKey;
    if (!key) continue;
    let clientId: string | undefined;
    if (key.startsWith('status:')) {
      const end = key.lastIndexOf(':');
      if (end > 'status:'.length && end < key.length - 1) clientId = key.slice('status:'.length, end);
    } else if (key.startsWith('[')) {
      try {
        const parts: unknown = JSON.parse(key);
        if (Array.isArray(parts) && ['terminal_agent_health', 'storage_health', 'kiosk_ui_error'].includes(parts[0])
          && typeof parts[1] === 'string') clientId = parts[1];
      } catch {
        continue;
      }
    }
    if (!clientId || isMonitoredClient(clientId, config)) continue;
    await prisma.$transaction(async (tx) => {
      await lockNotice(tx, key);
      await tx.kioskInquiryThread.updateMany({
        where: { id: thread.id, noticeResolvedAt: null }, data: { noticeResolvedAt: now }
      });
    });
  }
}
