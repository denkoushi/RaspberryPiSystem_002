import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';

export const SYSTEM_NOTICE_REPEAT_MS = 24 * 60 * 60 * 1000;
export const FILE_NOTICE_EXPIRY_MS = 48 * 60 * 60 * 1000;
export const FILE_NOTICE_PREFIX = 'file:';
export type SystemNotice = { key: string; title: string; body: string; state: 'open' | 'recovered' };

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
      && now.getTime() - thread.messages[0].createdAt.getTime() < SYSTEM_NOTICE_REPEAT_MS) {
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
