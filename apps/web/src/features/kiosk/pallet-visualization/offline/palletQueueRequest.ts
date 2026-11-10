import { getResolvedClientKey, postKioskPalletVisualizationItem, postKioskPalletVisualizationItemReplace } from '../../../../api/client';

type Request = {
  machineCd: string;
  palletNo: number;
  clientKey?: string;
} & (
  | { route: 'add'; body: { machineCd: string; palletNo: number; manufacturingOrderBarcodeRaw: string } }
  | { route: 'replace'; itemId: string; body: { manufacturingOrderBarcodeRaw: string } }
);
export type PalletRequest = Request;
export type PalletQueueRequest = Request & { body: { eventKey: string; readAt: string } };

export function sendPalletRequest(request: PalletQueueRequest) {
  const clientKey = request.clientKey ?? getResolvedClientKey();
  return request.route === 'add'
    ? postKioskPalletVisualizationItem(request.body, clientKey)
    : postKioskPalletVisualizationItemReplace(request.itemId, request.body, clientKey);
}
