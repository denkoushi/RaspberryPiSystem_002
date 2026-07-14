import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { buttonClassName } from '../../components/ui/Button';

import { presentCompletedAssemblyItems } from './assemblyHomeItemPresentation';
import { AssemblyItemCard } from './AssemblyItemCard';
import { AssemblyItemPane } from './AssemblyItemPane';
import { kioskAssemblyRecordApprovalPath } from './assemblyRoutes';
import { useAssemblyRowExpansion } from './assemblyRowExpansion';

import type { AssemblyWorkSessionSummaryDto } from './types';

type Props = {
  sessions: AssemblyWorkSessionSummaryDto[];
  loading: boolean;
  onReload: () => void;
};

export function AssemblyCompletedPane({ sessions, loading, onReload }: Props) {
  const items = useMemo(() => presentCompletedAssemblyItems(sessions), [sessions]);
  const { isExpanded, toggle } = useAssemblyRowExpansion();

  return (
    <AssemblyItemPane
      heading="完了・承認"
      count={items.length}
      tone="amber"
      loading={loading}
      onReload={onReload}
      emptyMessage={loading ? '完了・承認の個体を読込中…' : '完了・承認の個体なし'}
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
          tone="amber"
          action={
            <Link
              to={kioskAssemblyRecordApprovalPath({ sessionId: item.id })}
              className={buttonClassName('ghostOnDark', 'inline-flex min-h-11 w-full items-center justify-center text-sm')}
            >
              記録確認
            </Link>
          }
        />
      ))}
    </AssemblyItemPane>
  );
}
