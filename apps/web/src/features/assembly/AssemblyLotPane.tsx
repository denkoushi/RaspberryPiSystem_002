import { useMemo } from 'react';

import { Button } from '../../components/ui/Button';

import { presentNotStartedAssemblyItems } from './assemblyHomeItemPresentation';
import { AssemblyItemCard } from './AssemblyItemCard';
import { AssemblyItemPane } from './AssemblyItemPane';
import { useAssemblyRowExpansion } from './assemblyRowExpansion';

import type { AssemblyWorkUnitInvalidationTarget } from './AssemblyWorkUnitInvalidationDialog';
import type { AssemblyLotSummaryDto } from './types';

type Props = {
  lots: AssemblyLotSummaryDto[];
  loading: boolean;
  busySerialId: string | null;
  onReload: () => void;
  onStartSerial: (lotId: string, lotSerialId: string) => void;
  onInvalidate: (target: AssemblyWorkUnitInvalidationTarget) => void;
};

export function AssemblyLotPane({ lots, loading, busySerialId, onReload, onStartSerial, onInvalidate }: Props) {
  const items = useMemo(() => presentNotStartedAssemblyItems(lots), [lots]);
  const { isExpanded, toggle } = useAssemblyRowExpansion();

  return (
    <AssemblyItemPane
      heading="着手前"
      count={items.length}
      tone="cyan"
      loading={loading}
      onReload={onReload}
      emptyMessage={loading ? '着手前の個体を読込中…' : '着手前の個体なし'}
    >
      {items.map((item) => (
        <AssemblyItemCard
          key={item.id}
          itemId={item.id}
          productNo={item.productNo}
          serialNo={item.serialNo}
          machineName={item.machineName}
          progressText={item.progressText}
          progressPercent={item.progressPercent}
          details={item.details}
          expanded={isExpanded(item.id)}
          onToggle={() => toggle(item.id)}
          tone="cyan"
          action={<div className="grid gap-2">
            <Button
              type="button"
              variant="primary"
              className="min-h-11 w-full text-sm"
              disabled={busySerialId === item.lotSerialId}
              onClick={() => onStartSerial(item.lotId, item.lotSerialId)}
            >
              {busySerialId === item.lotSerialId ? '開始中…' : '開始'}
            </Button>
            <Button
              type="button"
              variant="danger"
              className="min-h-10 w-full text-sm"
              onClick={() => onInvalidate({
                workUnitId: item.workUnitId,
                productNo: item.productNo,
                workId: item.serialNo,
                stateLabel: '着手前'
              })}
            >
              削除
            </Button>
          </div>}
        />
      ))}
    </AssemblyItemPane>
  );
}
