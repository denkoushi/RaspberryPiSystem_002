import type { Prisma, User } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { EmployeeService } from '../tools/employee.service.js';

type InquiryDevice = { id: string; inquiryReceiverEnabled: boolean; systemNoticeReceiverEnabled: boolean };
const employees = new EmployeeService();
const threadInclude = {
  senderClientDevice: { select: { name: true, location: true } },
  messages: { orderBy: { createdAt: 'desc' as const }, take: 1 }
} satisfies Prisma.KioskInquiryThreadInclude;
const openInclude = {
  senderClientDevice: { select: { name: true, location: true } },
  messages: {
    orderBy: { createdAt: 'asc' as const },
    include: { authorEmployee: { select: { displayName: true } } }
  }
} satisfies Prisma.KioskInquiryThreadInclude;

type ListedThread = Prisma.KioskInquiryThreadGetPayload<{ include: typeof threadInclude }>;
type OpenedThread = Prisma.KioskInquiryThreadGetPayload<{ include: typeof openInclude }>;

function presentThread(thread: ListedThread, isReceiver: boolean) {
  const last = thread.messages[0];
  return {
    id: thread.id,
    kind: thread.kind,
    noticeTitle: thread.noticeTitle,
    noticeResolvedAt: thread.noticeResolvedAt,
    isReceiver,
    senderClientDeviceName: thread.senderClientDevice?.name ?? null,
    senderLocation: thread.senderClientDevice?.location ?? null,
    page: thread.page,
    unread: isReceiver ? thread.receiverUnread : thread.senderUnread,
    lastMessageAt: thread.lastMessageAt,
    lastMessage: last ? { side: last.side, body: last.body, createdAt: last.createdAt } : null
  };
}

function presentOpenedThread(thread: OpenedThread, isReceiver: boolean) {
  return {
    thread: presentThread({ ...thread, messages: thread.messages.slice(-1) }, isReceiver),
    messages: thread.messages.map((message) => ({
      id: message.id,
      side: message.side,
      body: message.body,
      createdAt: message.createdAt,
      ...(message.side === 'RECEIVER' ? { authorDisplayName: message.authorEmployee?.displayName ?? null } : {})
    }))
  };
}

function isReceiver(device: InquiryDevice) {
  return device.inquiryReceiverEnabled || device.systemNoticeReceiverEnabled;
}

function receivesThread(device: InquiryDevice, kind: string) {
  return kind === 'SYSTEM_NOTICE' ? device.systemNoticeReceiverEnabled : device.inquiryReceiverEnabled;
}

function accessibleThreadWhere(device: InquiryDevice, threadId?: string): Prisma.KioskInquiryThreadWhereInput {
  return { id: threadId, OR: [
    { kind: 'INQUIRY', ...(!device.inquiryReceiverEnabled ? { senderClientDeviceId: device.id } : {}) },
    ...(device.systemNoticeReceiverEnabled ? [{ kind: 'SYSTEM_NOTICE' as const }] : [])
  ] };
}

function notFound(): ApiError {
  return new ApiError(404, 'お問い合わせが見つかりません', undefined, 'KIOSK_INQUIRY_NOT_FOUND');
}

export async function authorizeReceiver(device: InquiryDevice, employeeTagUid?: string, loginUser?: Pick<User, 'role'>): Promise<{ employeeId: string | null; canViewScreen: boolean }> {
  if (!isReceiver(device)) return { employeeId: null, canViewScreen: false };
  if (!employeeTagUid) {
    if (loginUser?.role === 'ADMIN' || loginUser?.role === 'MANAGER') return { employeeId: null, canViewScreen: false };
    throw new ApiError(401, '社員証が必要です', undefined, 'KIOSK_INQUIRY_EMPLOYEE_TAG_REQUIRED');
  }
  const employee = await employees.findByNfcTagUid(employeeTagUid);
  const allowed = employee?.status === 'ACTIVE'
    ? await prisma.kioskInquiryReceiverEmployee.findUnique({ where: { employeeId: employee.id } })
    : null;
  if (!allowed) {
    throw new ApiError(403, 'この社員証は利用できません', undefined, 'KIOSK_INQUIRY_EMPLOYEE_NOT_ALLOWED');
  }
  return { employeeId: allowed.employeeId, canViewScreen: allowed.canViewScreen };
}

export async function createKioskInquiryThread(
  params: { clientDeviceId: string; page: string; body: string },
  tx: Prisma.TransactionClient
): Promise<string> {
  const now = new Date();
  const thread = await tx.kioskInquiryThread.create({
    data: {
      senderClientDeviceId: params.clientDeviceId,
      page: params.page,
      lastMessageAt: now,
      messages: { create: { side: 'SENDER', body: params.body, authorClientDeviceId: params.clientDeviceId, createdAt: now } }
    }
  });
  return thread.id;
}

const READ_ALL_UNLISTED_LIMIT = 200;

function unreadThreadWhere(device: InquiryDevice) {
  return {
    inquiry: {
      kind: 'INQUIRY',
      ...(device.inquiryReceiverEnabled ? { receiverUnread: true } : { senderClientDeviceId: device.id, senderUnread: true })
    },
    systemNotice: device.systemNoticeReceiverEnabled
      ? { kind: 'SYSTEM_NOTICE', receiverUnread: true, noticeResolvedAt: null } : undefined
  } satisfies {
    inquiry: Prisma.KioskInquiryThreadWhereInput;
    systemNotice?: Prisma.KioskInquiryThreadWhereInput;
  };
}

export async function getKioskInquirySummary(device: InquiryDevice, loginUser?: Pick<User, 'role'>) {
  const { inquiry, systemNotice } = unreadThreadWhere(device);
  const unreadCount = await prisma.kioskInquiryThread.count({
    where: { OR: systemNotice ? [inquiry, systemNotice] : [inquiry] }
  });
  return { isReceiver: isReceiver(device), unreadCount,
    loginUnlock: isReceiver(device) && (loginUser?.role === 'ADMIN' || loginUser?.role === 'MANAGER') };
}

export async function markAllKioskInquiriesRead(
  device: InquiryDevice,
  { threads }: { threads: { id: string; lastMessageAt: string }[] },
  employeeTagUid?: string,
  loginUser?: Pick<User, 'role'>
) {
  await authorizeReceiver(device, employeeTagUid, loginUser);
  if (threads.length === 0) return { updatedCount: 0 };

  const { inquiry, systemNotice } = unreadThreadWhere(device);
  const readScope = { OR: threads.map(({ id, lastMessageAt }) => ({ id, lastMessageAt: new Date(lastMessageAt) })) };
  return prisma.$transaction(async (tx) => {
    const inquiries = await tx.kioskInquiryThread.updateMany({
      where: { AND: [inquiry, readScope] },
      data: device.inquiryReceiverEnabled ? { receiverUnread: false } : { senderUnread: false }
    });
    const notices = systemNotice && await tx.kioskInquiryThread.updateMany({
      where: { AND: [systemNotice, readScope] },
      data: { receiverUnread: false }
    });
    return { updatedCount: inquiries.count + (notices?.count ?? 0) };
  });
}

export async function listKioskInquiries(device: InquiryDevice, employeeTagUid?: string, loginUser?: Pick<User, 'role'>) {
  const { canViewScreen } = await authorizeReceiver(device, employeeTagUid, loginUser);
  const pageSize = isReceiver(device) ? 50 : 20;
  const { inquiry, systemNotice } = unreadThreadWhere(device);
  // 一覧の取得前に、画面外でも既読にできる候補を確定する。
  const unread = await prisma.kioskInquiryThread.findMany({
    where: { OR: systemNotice ? [inquiry, systemNotice] : [inquiry] },
    orderBy: { lastMessageAt: 'desc' },
    take: pageSize + READ_ALL_UNLISTED_LIMIT,
    select: { id: true, lastMessageAt: true }
  });
  const threads = await prisma.kioskInquiryThread.findMany({
    where: { AND: [accessibleThreadWhere(device), { OR: [{ kind: 'INQUIRY' }, { noticeResolvedAt: null }] }] },
    orderBy: { lastMessageAt: 'desc' },
    take: pageSize,
    include: threadInclude
  });
  const listedIds = new Set(threads.map(({ id }) => id));
  const unreadElsewhere = unread.filter(({ id }) => !listedIds.has(id))
    .slice(0, READ_ALL_UNLISTED_LIMIT)
    .map(({ id, lastMessageAt }) => ({ id, lastMessageAt: lastMessageAt.toISOString() }));
  return { canViewScreen, unreadElsewhere, threads: threads.map((thread) => presentThread(thread, receivesThread(device, thread.kind))) };
}

export async function openKioskInquiry(device: InquiryDevice, threadId: string, employeeTagUid?: string, loginUser?: Pick<User, 'role'>) {
  const { canViewScreen } = await authorizeReceiver(device, employeeTagUid, loginUser);
  return prisma.$transaction(async (tx) => {
    const accessible = await tx.kioskInquiryThread.findFirst({ where: accessibleThreadWhere(device, threadId), select: { kind: true } });
    if (!accessible) throw notFound();
    const receiver = receivesThread(device, accessible.kind);
    // Lock the thread before reading messages so a concurrent reply cannot be marked read unseen.
    const updated = await tx.kioskInquiryThread.updateMany({
      where: accessibleThreadWhere(device, threadId),
      data: receiver ? { receiverUnread: false } : { senderUnread: false }
    });
    if (updated.count === 0) throw notFound();
    const thread = await tx.kioskInquiryThread.findUniqueOrThrow({ where: { id: threadId }, include: openInclude });
    return { ...presentOpenedThread(thread, receiver), canViewScreen: receiver && canViewScreen };
  });
}

export async function replyToKioskInquiry(
  device: InquiryDevice,
  threadId: string,
  body: string,
  employeeTagUid?: string,
  loginUser?: Pick<User, 'role'>
) {
  const { employeeId: authorEmployeeId } = await authorizeReceiver(device, employeeTagUid, loginUser);
  return prisma.$transaction(async (tx) => {
    const accessible = await tx.kioskInquiryThread.findFirst({ where: accessibleThreadWhere(device, threadId), select: { kind: true } });
    if (!accessible) throw notFound();
    const receiver = receivesThread(device, accessible.kind);
    const now = new Date();
    const updated = await tx.kioskInquiryThread.updateMany({
      where: accessibleThreadWhere(device, threadId),
      data: {
        receiverUnread: !receiver,
        senderUnread: receiver && accessible.kind === 'INQUIRY',
        lastMessageAt: now
      }
    });
    if (updated.count === 0) throw notFound();
    await tx.kioskInquiryMessage.create({
      data: {
        threadId,
        side: receiver ? 'RECEIVER' : 'SENDER',
        body,
        authorClientDeviceId: device.id,
        authorEmployeeId,
        createdAt: now
      }
    });
    const thread = await tx.kioskInquiryThread.findUniqueOrThrow({ where: { id: threadId }, include: openInclude });
    return presentOpenedThread(thread, receiver);
  });
}
