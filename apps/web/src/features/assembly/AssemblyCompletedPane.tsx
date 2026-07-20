import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { buttonClassName } from '../../components/ui/Button';

import { presentCompletedAssemblyItems } from './assemblyHomeItemPresentation';
import { AssemblyItemCard } from './AssemblyItemCard';
import { AssemblyItemPane } from './AssemblyItemPane';
import { kioskAssemblyRecordApprovalPath, kioskAssemblyTraceabilityPath } from './assemblyRoutes';
import { useAssemblyRowExpansion } from './assemblyRowExpansion';

import type { AssemblyWorkSessionSummaryDto } from './types';

type Props = {
  sessions: AssemblyWorkSessionSummaryDto[];
  loading: boolean;
  onReload: () => void;
};

export function AssemblyCompletedPane({ sessions, loading, onReload }: Props) {
  const items = useMemo(() => presentCompletedAssemblyItems(sessions), [sessions]);
  const sessionById = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions]);
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
      {items.map((item) => {
          const session = sessionById.get(item.id);
          const formalStatus = session?.isTopLevel === false
            ? 'サブアセンブリ'
            : session?.formalId ? `正式ID ${session.formalId}` : '正式ID未登録';
          return (
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
              action={<div className="grid gap-2">
                <p className="rounded border border-cyan-300/25 bg-cyan-500/10 px-2 py-1 text-center text-xs font-bold text-cyan-100">{formalStatus}</p>
                <Link
                  to={kioskAssemblyRecordApprovalPath({ sessionId: item.id })}
                  className={buttonClassName('ghostOnDark', 'inline-flex min-h-11 w-full items-center justify-center text-sm')}
                >
                  記録確認
                </Link>
                <Link
                  to={kioskAssemblyTraceabilityPath({ workId: item.serialNo })}
                  className={buttonClassName('ghostOnDark', 'inline-flex min-h-11 w-full items-center justify-center text-sm')}
                >
                  正式IDを確認・登録
                </Link>
              </div>}
            />
          );
      })}
    </AssemblyItemPane>
  );
}
