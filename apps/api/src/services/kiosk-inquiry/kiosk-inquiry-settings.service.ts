import type { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

const employeeSelect = { id: true, employeeCode: true, displayName: true };
function presentEmployee(employee: { id: string; employeeCode: string; displayName: string }) {
  return { employeeId: employee.id, employeeCode: employee.employeeCode, displayName: employee.displayName };
}

export async function getInquiryReceiverSettings(tx: Prisma.TransactionClient = prisma) {
  const devices = await tx.clientDevice.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, location: true, inquiryReceiverEnabled: true }
  });
  const receivers = await tx.kioskInquiryReceiverEmployee.findMany({
    orderBy: { employee: { employeeCode: 'asc' } },
    include: { employee: { select: employeeSelect } }
  });
  return { devices, employees: receivers.map(({ employee }) => presentEmployee(employee)) };
}

export async function replaceInquiryReceiverSettings(receiverClientDeviceIds: string[], employeeCodes: string[]) {
  const deviceIds = [...new Set(receiverClientDeviceIds)];
  const codes = [...new Set(employeeCodes)];
  return prisma.$transaction(async (tx) => {
    const devices = await tx.clientDevice.findMany({ where: { id: { in: deviceIds } }, select: { id: true } });
    const employees = await tx.employee.findMany({ where: { employeeCode: { in: codes } }, select: employeeSelect });
    const missingCodes = codes.filter((code) => !employees.some((employee) => employee.employeeCode === code));
    if (missingCodes.length) {
      throw new ApiError(400, '社員番号が見つかりません', missingCodes, 'KIOSK_INQUIRY_EMPLOYEE_CODE_NOT_FOUND');
    }
    const missingIds = deviceIds.filter((id) => !devices.some((device) => device.id === id));
    if (missingIds.length) {
      throw new ApiError(400, '端末が見つかりません', missingIds, 'KIOSK_INQUIRY_CLIENT_DEVICE_NOT_FOUND');
    }
    await tx.clientDevice.updateMany({ data: { inquiryReceiverEnabled: false } });
    await tx.clientDevice.updateMany({ where: { id: { in: deviceIds } }, data: { inquiryReceiverEnabled: true } });
    await tx.kioskInquiryReceiverEmployee.deleteMany();
    if (employees.length) {
      await tx.kioskInquiryReceiverEmployee.createMany({ data: employees.map(({ id }) => ({ employeeId: id })) });
    }
    return getInquiryReceiverSettings(tx);
  });
}

export async function lookupInquiryReceiverEmployee(employeeCode: string) {
  const employee = await prisma.employee.findUnique({ where: { employeeCode }, select: employeeSelect });
  if (!employee) {
    throw new ApiError(404, '社員番号が見つかりません', undefined, 'KIOSK_INQUIRY_EMPLOYEE_CODE_NOT_FOUND');
  }
  return presentEmployee(employee);
}
