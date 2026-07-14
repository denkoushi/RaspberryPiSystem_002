import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { buttonClassName } from '../../components/ui/Button';

import { presentWipAssemblyItems } from './assemblyHomeItemPresentation';
import { AssemblyItemCard } from './AssemblyItemCard';
import { AssemblyItemPane } from './AssemblyItemPane';
import { kioskAssemblyWorkSessionPath } from './assemblyRoutes';
import { useAssemblyRowExpansion } from './assemblyRowExpansion';

import type { AssemblyWorkSessionSummaryDto } from './types';

type Props = {
  sessions: AssemblyWorkSessionSummaryDto[];
  loading: boolean;
  onReload: () => void;
};

export function AssemblyWipPane({ sessions, loading, onReload }: Props) {
  const items = useMemo(() => presentWipAssemblyItems(sessions), [sessions]);
  const { isExpanded, toggle } = useAssemblyRowExpansion();

  return (
    <AssemblyItemPane
      heading="仕掛中"
      count={items.length}
      tone="emerald"
      loading={loading}
      onReload={onReload}
      emptyMessage={loading ? '仕掛中の個体を読込中…' : '仕掛中の個体なし'}
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
          tone="emerald"
          action={
            <Link
              to={kioskAssemblyWorkSessionPath(item.id)}
              className={buttonClassName('primary', 'inline-flex min-h-11 w-full items-center justify-center text-sm')}
            >
              再開
            </Link>
          }
        />
      ))}
    </AssemblyItemPane>
  );
}
