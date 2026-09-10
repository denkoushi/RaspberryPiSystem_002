import { memo, useEffect, useRef, useState } from 'react';

import { LeaderOrderRowOrderSelect } from '../leaderOrderBoard/LeaderOrderRowOrderSelect';

import { ORDER_NUMBERS } from './resourceColors';

type Props = {
  rowId: string;
  resourceCd: string;
  currentOrder: number | null;
  disabled: boolean;
  orderPending: boolean;
  getAvailableOrders: (resourceCd: string, current: number | null) => number[];
  onChange: (rowId: string, resourceCd: string, nextValue: string) => void | Promise<unknown>;
};

function ProductionScheduleOrderSelectInner({
  rowId,
  resourceCd,
  currentOrder,
  disabled,
  orderPending,
  getAvailableOrders,
  onChange
}: Props) {
  const [pendingOrder, setPendingOrder] = useState<number | null | undefined>(undefined);
  const pendingMetaRef = useRef<{
    initialOrder: number | null;
    observedPending: boolean;
  } | null>(null);
  const displayOrder = pendingOrder !== undefined ? pendingOrder : currentOrder;

  useEffect(() => {
    const pendingMeta = pendingMetaRef.current;
    if (pendingOrder === undefined || !pendingMeta) return;
    if (orderPending) {
      pendingMeta.observedPending = true;
      return;
    }
    if (
      currentOrder === pendingOrder ||
      currentOrder !== pendingMeta.initialOrder ||
      pendingMeta.observedPending
    ) {
      pendingMetaRef.current = null;
      setPendingOrder(undefined);
    }
  }, [currentOrder, orderPending, pendingOrder]);

  const availableOrders = getAvailableOrders(resourceCd, displayOrder);
  const usageNumbers = ORDER_NUMBERS.filter((number) => !availableOrders.includes(number));

  return (
    <LeaderOrderRowOrderSelect
      resourceCd={resourceCd}
      currentOrder={displayOrder}
      usageNumbers={usageNumbers}
      disabled={disabled}
      onChange={(nextValue) => {
        const nextOrder = nextValue.length > 0 ? Number(nextValue) : null;
        pendingMetaRef.current = { initialOrder: currentOrder, observedPending: false };
        setPendingOrder(nextOrder);
        const saveResult = onChange(rowId, resourceCd, nextValue);
        if (saveResult && typeof (saveResult as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(saveResult).then(
            () => {
              pendingMetaRef.current = null;
              setPendingOrder(undefined);
            },
            () => {
              pendingMetaRef.current = null;
              setPendingOrder(undefined);
            }
          );
        }
      }}
    />
  );
}

export const ProductionScheduleOrderSelect = memo(ProductionScheduleOrderSelectInner);
