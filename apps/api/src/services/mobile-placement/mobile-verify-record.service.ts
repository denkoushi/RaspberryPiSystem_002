import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';
import { resolveSeibanMachineDisplayNamesBatched } from '../production-schedule/seiban-machine-display-names.service.js';

const text = z.string().max(256);
export const verifyRecordBodySchema = z.object({
  clientVerifyId: z.string().uuid(),
  verifiedAt: z.string().datetime({ offset: true }),
  transferOrderBarcodeRaw: text,
  transferPartRaw: text.optional(),
  actualOrderBarcodeRaw: text,
  actualFseibanRaw: text,
  actualPartRaw: text.optional(),
  outcome: z.enum(['match', 'mismatch', 'not_found', 'error']),
  reason: z.enum(['match', 'different_seiban', 'different_part', 'part_required', 'order_not_found', 'transfer_not_found']).optional(),
  expectedFseiban: text.optional(),
  expectedFhincd: text.optional(),
  expectedPartName: text.optional(),
  actualResolvedFseiban: text.optional(),
  actualPartCode: text.optional(),
  matchedBy: z.enum(['part_name']).optional(),
  clientRecordId: z.string().uuid().optional()
});

export async function saveMobileVerifyRecord(body: z.infer<typeof verifyRecordBodySchema>, clientDeviceId: string) {
  try {
    const record = await prisma.mobileSlipVerifyRecord.create({ data: { ...body, clientDeviceId, verifiedAt: new Date(body.verifiedAt) } });
    return { status: 201, record };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
  }
  // Conditional update also protects concurrent links and records owned by another phone.
  if (body.clientRecordId) {
    const updated = await prisma.mobileSlipVerifyRecord.updateMany({
      where: { clientVerifyId: body.clientVerifyId, clientDeviceId, clientRecordId: null },
      data: { clientRecordId: body.clientRecordId }
    });
    if (updated.count) return { status: 200, record: { clientVerifyId: body.clientVerifyId, clientRecordId: body.clientRecordId } };
  }
  throw new ApiError(409, '保存済みです');
}

export const verifyRecordQuerySchema = z.object({ days: z.enum(['1', '7', '30']).default('7') });
const field = (row: Prisma.JsonValue | undefined, key: string): string | null => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const value = row[key];
  return typeof value === 'string' ? value.trim() || null : null;
};

export async function listMobileVerifyRecords(query: z.infer<typeof verifyRecordQuerySchema>) {
  const rows = await prisma.mobileSlipVerifyRecord.findMany({
    where: { verifiedAt: { gte: new Date(Date.now() - Number(query.days) * 86400000) } },
    include: { clientDevice: { select: { name: true } } },
    orderBy: [{ verifiedAt: 'desc' }, { id: 'asc' }], take: 500
  });
  if (!rows.length) return [];
  const orders = [...new Set(rows.map(row => row.transferOrderBarcodeRaw.trim()))];
  const links = rows.flatMap(row => row.clientRecordId ? [row.clientRecordId] : []);
  const [schedule, placements] = await Promise.all([
    prisma.csvDashboardRow.findMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, OR: orders.map(order => ({ rowData: { path: ['ProductNo'], equals: order } })) },
      select: { rowData: true }, orderBy: { id: 'asc' }
    }),
    links.length ? prisma.orderPlacementEvent.findMany({
      where: { clientRecordId: { in: links } },
      select: { clientRecordId: true, clientDeviceId: true, shelfCodeRaw: true, branchNo: true }
    }) : []
  ]);
  const scheduleByOrder = new Map<string, Prisma.JsonValue>();
  for (const row of schedule) {
    const order = field(row.rowData, 'ProductNo');
    if (order && !scheduleByOrder.has(order)) scheduleByOrder.set(order, row.rowData);
  }
  const placementById = new Map(placements.map(row => [row.clientRecordId, row]));
  const records = rows.map(row => {
    const scheduleRow = scheduleByOrder.get(row.transferOrderBarcodeRaw.trim());
    const linked = placementById.get(row.clientRecordId);
    const placement = linked?.clientDeviceId === row.clientDeviceId ? linked : undefined;
    return {
      id: row.id, verifiedAt: row.verifiedAt.toISOString(), deviceName: row.clientDevice.name,
      result: row.outcome, reason: row.reason,
      transfer: { orderNo: row.transferOrderBarcodeRaw, partNo: row.transferPartRaw || row.expectedFhincd || field(scheduleRow, 'FHINCD'), fseiban: row.expectedFseiban || field(scheduleRow, 'FSEIBAN') },
      actual: { slipNo: row.actualOrderBarcodeRaw || null, partNo: row.actualPartRaw || row.actualPartCode || null, fseiban: row.actualResolvedFseiban || row.actualFseibanRaw || null },
      mismatch: row.reason === 'different_seiban' ? 'fseiban' as const : row.reason === 'different_part' ? 'part' as const : null,
      fhinmei: row.expectedPartName || field(scheduleRow, 'FHINMEI'),
      placedShelfCodeRaw: placement?.shelfCodeRaw ?? null, branchNo: placement?.branchNo ?? null
    };
  });
  const { machineNames } = await resolveSeibanMachineDisplayNamesBatched(records.flatMap(row => row.transfer.fseiban ? [row.transfer.fseiban] : []));
  return records.map(row => ({ ...row, machineName: row.transfer.fseiban ? machineNames[row.transfer.fseiban] ?? null : null }));
}
