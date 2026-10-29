import { createHaizenClientRecordId } from '../haizen/offline/haizenOfflineQueueStore';
import { requestSync } from '../sync/syncScheduler';

import { verifyRecordStore, type VerifyRecord, type VerifyRecordStore } from './verifyRecordStore';

import type { MobilePlacementSlipMatchResponse } from '../../../api/domains/mobile-placement';
import type { SlipPairMatchInput } from '@raspi-system/slip-match-core';

const inputKey = (input: SlipPairMatchInput) => JSON.stringify([
  input.transferOrderBarcodeRaw, input.transferPartBarcodeRaw ?? '', input.actualOrderBarcodeRaw,
  input.actualFseibanRaw, input.actualPartBarcodeRaw ?? ''
]);
export function createSlipVerifyRecorder(store: VerifyRecordStore = verifyRecordStore) {
  let last: { key: string; record: VerifyRecord } | undefined;
  return {
    async record(input: SlipPairMatchInput, result: MobilePlacementSlipMatchResponse | 'error') {
      const outcome = result === 'error' ? 'error' : result.ok ? 'match'
        : ['part_required', 'order_not_found', 'transfer_not_found'].includes(result.reason ?? '') ? 'not_found' : 'mismatch';
      const key = inputKey(input);
      if (last?.key === key && last.record.outcome === outcome) return;
      const record: VerifyRecord = {
        clientVerifyId: createHaizenClientRecordId(), verifiedAt: new Date().toISOString(),
        transferOrderBarcodeRaw: input.transferOrderBarcodeRaw, transferPartRaw: input.transferPartBarcodeRaw,
        actualOrderBarcodeRaw: input.actualOrderBarcodeRaw, actualFseibanRaw: input.actualFseibanRaw,
        actualPartRaw: input.actualPartBarcodeRaw, outcome,
        ...(result === 'error' ? {} : {
          reason: result.reason, expectedFseiban: result.expected?.fseiban, expectedFhincd: result.expected?.fhincd,
          expectedPartName: result.expected?.partName, actualResolvedFseiban: result.actual?.fseiban,
          actualPartCode: result.actual?.partCode, matchedBy: result.matchedBy
        })
      };
      await store.put(record);
      last = { key, record };
      requestSync('verify-record-saved');
    },
    async link(input: SlipPairMatchInput, clientRecordId: string) {
      if (!last || last.key !== inputKey(input)) return;
      const record = { ...last.record, clientRecordId };
      last = { ...last, record };
      await store.put(record);
      requestSync('verify-record-linked');
    }
  };
}
