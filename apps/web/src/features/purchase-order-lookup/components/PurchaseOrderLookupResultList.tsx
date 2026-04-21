import { buildPurchaseOrderRowLines } from '../model/buildPurchaseOrderRowLines';
import { purchaseOrderLookupKioskTheme as t } from '../ui/purchaseOrderLookupKioskTheme';

import type { PurchaseOrderLookupResponse } from '../../../api/client';

export type PurchaseOrderLookupResultListProps = {
  data: PurchaseOrderLookupResponse;
};

/**
 * ラベルなし・値のみ（機種→製番→着手日→品名→品番→個数）。
 */
export function PurchaseOrderLookupResultList({ data }: PurchaseOrderLookupResultListProps) {
  if (data.rows.length === 0) {
    return <div className={t.emptyState}>データがありません</div>;
  }

  return (
    <div className={t.resultList}>
      {data.rows.map((row, i) => {
        const vm = buildPurchaseOrderRowLines(row);
        return (
          <article
            key={`${row.seiban}-${row.purchasePartCodeNormalized}-${i}`}
            className={t.resultCard}
            aria-label="照会結果1件"
          >
            <div className={t.valueLine}>{vm.machineName}</div>
            <div className={t.valueLine}>{vm.seiban}</div>
            <div className={t.valueLine}>{vm.plannedStartDisplay}</div>
            <div className={t.valueLine}>
              {vm.purchasePartName}
              {vm.hinmeiSubLine != null ? (
                <span className={t.hinmeiSub}>{vm.hinmeiSubLine}</span>
              ) : null}
            </div>
            <div className={t.valueLine}>{vm.partCode}</div>
            <div className={t.valueLine}>{vm.quantityDisplay}</div>
          </article>
        );
      })}
    </div>
  );
}
