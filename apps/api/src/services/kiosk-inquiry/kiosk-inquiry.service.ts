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

export async function getKioskInquirySummary(device: InquiryDevice, loginUser?: Pick<User, 'role'>) {
  const unreadCount = await prisma.kioskInquiryThread.count({
    where: { OR: [
      { kind: 'INQUIRY', ...(device.inquiryReceiverEnabled
        ? { receiverUnread: true } : { senderClientDeviceId: device.id, senderUnread: true }) },
      ...(device.systemNoticeReceiverEnabled ? [{ kind: 'SYSTEM_NOTICE' as const, receiverUnread: true, noticeResolvedAt: null }] : [])
    ] }
  });
  return { isReceiver: isReceiver(device), unreadCount,
    loginUnlock: isReceiver(device) && (loginUser?.role === 'ADMIN' || loginUser?.role === 'MANAGER') };
}

export async function listKioskInquiries(device: InquiryDevice, employeeTagUid?: string, loginUser?: Pick<User, 'role'>) {
  const { canViewScreen } = await authorizeReceiver(device, employeeTagUid, loginUser);
  const threads = await prisma.kioskInquiryThread.findMany({
    where: { AND: [accessibleThreadWhere(device), { OR: [{ kind: 'INQUIRY' }, { noticeResolvedAt: null }] }] },
    orderBy: { lastMessageAt: 'desc' },
    take: isReceiver(device) ? 50 : 20,
    include: threadInclude
  });
  return { canViewScreen, threads: threads.map((thread) => presentThread(thread, receivesThread(device, thread.kind))) };
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
