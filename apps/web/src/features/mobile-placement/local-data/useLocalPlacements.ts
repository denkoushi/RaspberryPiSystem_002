import { useEffect, useState } from 'react';

import { haizenOfflineQueueStore } from '../haizen/offline/haizenOfflineQueueStore';
import { haizenOutboxRunner } from '../haizen/offline/haizenOutboxRunner';
import { placementDeleteOutboxRunner } from '../part-search/offline/placementDeleteOutboxRunner';
import { placementDeleteQueueStore } from '../part-search/offline/placementDeleteQueueStore';
import { useCanSync } from '../sync/networkGate';

import { mobileLocalDataStore } from './mobileLocalDataStore';

import type { PartSearchRow } from '@raspi-system/part-search-core';
import type { LocalPlacementRow } from '@raspi-system/slip-match-core';

const pendingPrefix = 'haizen:';
const toSearchRow = (row: LocalPlacementRow): PartSearchRow => ({ ...row, manufacturingOrder: row.manufacturingOrderBarcodeRaw });

export function useLocalPlacements() {
  const online = useCanSync();
  const [data, setData] = useState<{ rows: PartSearchRow[]; updatedAt?: string }>({ rows: [] });
  useEffect(() => {
    let alive = true;
    let generation = 0;
    const haizen = haizenOutboxRunner();
    const refresh = async () => {
      const current = ++generation;
      try {
        const [placements, deletions, registrations, versions] = await Promise.all([
          mobileLocalDataStore.listPlacements(), placementDeleteQueueStore.list(), haizenOfflineQueueStore.list(), mobileLocalDataStore.versions()
        ]);
        const hidden = new Set(deletions.filter((record) => record.status === 'pending').map((record) => record.id));
        const pending = registrations.filter((record) => record.status === 'pending' && record.slipKind === 'manufacturing_order');
        const pendingRows = await Promise.all(pending.map(async (record): Promise<PartSearchRow> => {
          const [schedule] = await mobileLocalDataStore.listScheduleByProductNo(record.number);
          return { id: `${pendingPrefix}${record.clientRecordId}`, shelfCodeRaw: record.shelfCode,
            manufacturingOrder: record.number, branchNo: record.branchNo ?? 0, productNo: schedule?.productNo ?? record.number,
            fseiban: schedule?.fseiban ?? '', fhincd: schedule?.fhincd ?? '', fhinmei: schedule?.fhinmei ?? '',
            machineName: placements.find((row) => schedule?.fseiban && row.fseiban === schedule.fseiban)?.machineName ?? '' };
        }));
        const rows = placements.filter((row) => !hidden.has(row.id)).map(toSearchRow);
        if (alive && current === generation) setData({ rows: [...rows, ...pendingRows], updatedAt: versions.placements?.dataUpdatedAt ?? undefined });
      } catch { /* Keep the last readable local view; reads never fall back to the server. */ }
    };
    const onChange = () => { void refresh(); };
    const unsubscribe = [mobileLocalDataStore.subscribe(onChange), placementDeleteQueueStore.subscribe(onChange),
      haizen.subscribe(onChange)];
    onChange();
    return () => { alive = false; unsubscribe.forEach((dispose) => dispose()); };
  }, []);
  return { ...data, offline: !online, onDelete: async (row: PartSearchRow) => {
    if (row.id.startsWith(pendingPrefix)) {
      const removed = await haizenOutboxRunner().retake(row.id.slice(pendingPrefix.length));
      if (!removed) throw new Error('同期後の一覧でもう一度確認してください');
      return;
    }
    const local = (await mobileLocalDataStore.listPlacements()).find((placement) => placement.id === row.id)
      ?? (await placementDeleteQueueStore.list()).find((record) => record.id === row.id)?.row;
    if (local) await placementDeleteOutboxRunner.submit(local);
  } };
}
