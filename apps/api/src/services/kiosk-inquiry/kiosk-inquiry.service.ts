import type { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { EmployeeService } from '../tools/employee.service.js';

type InquiryDevice = { id: string; inquiryReceiverEnabled: boolean };
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
    senderClientDeviceName: thread.senderClientDevice.name,
    senderLocation: thread.senderClientDevice.location,
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

function accessibleThreadWhere(device: InquiryDevice, threadId: string): Prisma.KioskInquiryThreadWhereInput {
  return { id: threadId, ...(!device.inquiryReceiverEnabled ? { senderClientDeviceId: device.id } : {}) };
}

function notFound(): ApiError {
  return new ApiError(404, 'お問い合わせが見つかりません', undefined, 'KIOSK_INQUIRY_NOT_FOUND');
}

async function authorizeReceiver(device: InquiryDevice, employeeTagUid?: string): Promise<string | null> {
  if (!device.inquiryReceiverEnabled) return null;
  if (!employeeTagUid) {
    throw new ApiError(401, '社員証が必要です', undefined, 'KIOSK_INQUIRY_EMPLOYEE_TAG_REQUIRED');
  }
  const employee = await employees.findByNfcTagUid(employeeTagUid);
  const allowed = employee?.status === 'ACTIVE'
    ? await prisma.kioskInquiryReceiverEmployee.findUnique({ where: { employeeId: employee.id } })
    : null;
  if (!allowed) {
    throw new ApiError(403, 'この社員証は利用できません', undefined, 'KIOSK_INQUIRY_EMPLOYEE_NOT_ALLOWED');
  }
  return allowed.employeeId;
}

export async function createKioskInquiryThread(
  params: { clientDeviceId: string; page: string; body: string },
  tx: Prisma.TransactionClient
): Promise<void> {
  const now = new Date();
  await tx.kioskInquiryThread.create({
    data: {
      senderClientDeviceId: params.clientDeviceId,
      page: params.page,
      lastMessageAt: now,
      messages: { create: { side: 'SENDER', body: params.body, authorClientDeviceId: params.clientDeviceId, createdAt: now } }
    }
  });
}

export async function getKioskInquirySummary(device: InquiryDevice) {
  const unreadCount = await prisma.kioskInquiryThread.count({
    where: device.inquiryReceiverEnabled
      ? { receiverUnread: true }
      : { senderClientDeviceId: device.id, senderUnread: true }
  });
  return { isReceiver: device.inquiryReceiverEnabled, unreadCount };
}

export async function listKioskInquiries(device: InquiryDevice, employeeTagUid?: string) {
  await authorizeReceiver(device, employeeTagUid);
  const threads = await prisma.kioskInquiryThread.findMany({
    where: device.inquiryReceiverEnabled ? {} : { senderClientDeviceId: device.id },
    orderBy: { lastMessageAt: 'desc' },
    take: device.inquiryReceiverEnabled ? 50 : 20,
    include: threadInclude
  });
  return { threads: threads.map((thread) => presentThread(thread, device.inquiryReceiverEnabled)) };
}

export async function openKioskInquiry(device: InquiryDevice, threadId: string, employeeTagUid?: string) {
  await authorizeReceiver(device, employeeTagUid);
  return prisma.$transaction(async (tx) => {
    // Lock the thread before reading messages so a concurrent reply cannot be marked read unseen.
    const updated = await tx.kioskInquiryThread.updateMany({
      where: accessibleThreadWhere(device, threadId),
      data: device.inquiryReceiverEnabled ? { receiverUnread: false } : { senderUnread: false }
    });
    if (updated.count === 0) throw notFound();
    const thread = await tx.kioskInquiryThread.findUniqueOrThrow({ where: { id: threadId }, include: openInclude });
    return presentOpenedThread(thread, device.inquiryReceiverEnabled);
  });
}

export async function replyToKioskInquiry(
  device: InquiryDevice,
  threadId: string,
  body: string,
  employeeTagUid?: string
) {
  const authorEmployeeId = await authorizeReceiver(device, employeeTagUid);
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const updated = await tx.kioskInquiryThread.updateMany({
      where: accessibleThreadWhere(device, threadId),
      data: {
        receiverUnread: !device.inquiryReceiverEnabled,
        senderUnread: device.inquiryReceiverEnabled,
        lastMessageAt: now
      }
    });
    if (updated.count === 0) throw notFound();
    await tx.kioskInquiryMessage.create({
      data: {
        threadId,
        side: device.inquiryReceiverEnabled ? 'RECEIVER' : 'SENDER',
        body,
        authorClientDeviceId: device.id,
        authorEmployeeId,
        createdAt: now
      }
    });
    const thread = await tx.kioskInquiryThread.findUniqueOrThrow({ where: { id: threadId }, include: openInclude });
    return presentOpenedThread(thread, device.inquiryReceiverEnabled);
  });
}
