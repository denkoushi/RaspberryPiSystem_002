import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { deliverSystemNotice } from '../kiosk-inquiry/system-notice.service.js';
import { listScheduleRowsByProductNo } from '../production-schedule/production-schedule-lookup.service.js';
import { findPurchaseOrderLookupRows } from '../purchase-order-lookup/purchase-order-lookup-query.service.js';
import { registerOrderPlacement } from './mobile-placement-order-placement.service.js';

export type EdgeScanInput = {
  clientDeviceId: string;
  clientRecordId: string;
  scannedAt: string;
  orderNumber: string;
  branchNo: number;
};

export async function registerEdgeScan(input: EdgeScanInput) {
  const device = await prisma.clientDevice.findUnique({ where: { id: input.clientDeviceId } });
  if (!device?.haizenEdgeEnabled) {
    throw new ApiError(422, 'この端末は棚スキャナとして有効になっていません。', undefined, 'EDGE_DEVICE_NOT_ENABLED');
  }

  try {
    const shelfCodeRaw = device.haizenPresetShelfCodeRaw?.trim();
    if (!shelfCodeRaw) {
      throw new ApiError(422, '棚スキャナに棚が割り当てられていません。', undefined, 'EDGE_SHELF_NOT_ASSIGNED');
    }
    const orderNumber = input.orderNumber.trim();
    if (!/^\d{10}$/.test(orderNumber)) {
      throw new ApiError(422, '番号は前後の空白を除いて10桁の数字で読み取ってください。', undefined, 'EDGE_ORDER_NOT_FOUND');
    }

    let slipKind: 'manufacturing_order' | 'purchase_order' = 'manufacturing_order';
    const replay = await prisma.orderPlacementEvent.findUnique({ where: { clientRecordId: input.clientRecordId } });
    if (!replay && (await listScheduleRowsByProductNo(orderNumber)).length === 0) {
      const rows = await findPurchaseOrderLookupRows(orderNumber);
      if (rows.length === 0) {
        throw new ApiError(422, '読み取った番号が製造予定にも購買データにもありません。', undefined, 'EDGE_ORDER_NOT_FOUND');
      }
      if (new Set(rows.map((row) => row.seiban.trim()).filter(Boolean)).size > 1) {
        throw new ApiError(422, '読み取った注文番号に複数の製番があるため配膳を記録できません。', undefined, 'EDGE_ORDER_AMBIGUOUS');
      }
      slipKind = 'purchase_order';
    }

    const result = await registerOrderPlacement({
      clientDeviceId: input.clientDeviceId,
      clientRecordId: input.clientRecordId,
      placedAt: input.scannedAt,
      manufacturingOrderBarcodeRaw: orderNumber,
      shelfCodeRaw,
      branchNo: input.branchNo,
      slipKind
    });
    return { status: result.action, branchNo: result.branchState.branchNo, shelfCodeRaw: result.branchState.shelfCodeRaw };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    let failure = error;
    if (error.code === 'ORDER_PLACEMENT_SCHEDULE_NOT_FOUND' || error.code === 'ORDER_PLACEMENT_PURCHASE_ORDER_NOT_FOUND') {
      failure = new ApiError(422, '読み取った番号のデータが見つからないため配膳を記録できません。', undefined, 'EDGE_ORDER_NOT_FOUND');
    } else if (error.code === 'ORDER_PLACEMENT_PURCHASE_ORDER_AMBIGUOUS') {
      failure = new ApiError(422, '読み取った注文番号に複数の製番があるため配膳を記録できません。', undefined, 'EDGE_ORDER_AMBIGUOUS');
    }
    if (failure.statusCode === 422 && ['EDGE_SHELF_NOT_ASSIGNED', 'EDGE_ORDER_NOT_FOUND', 'EDGE_ORDER_AMBIGUOUS'].includes(failure.code ?? '')) {
      const key = JSON.stringify(['edge_scan', device.id, failure.code]);
      try {
        await deliverSystemNotice({
          key, title: `${device.location?.trim() || device.name} 棚スキャナ`, body: failure.code === 'EDGE_SHELF_NOT_ASSIGNED' ? failure.message : `${failure.message}（${input.orderNumber.trim()}）`,
          state: 'open'
        });
      } catch (noticeError) {
        logger.warn({ err: noticeError, key }, 'Failed to deliver edge scan system notice');
      }
    }
    throw failure;
  }
}
