import { useEffect, useState } from 'react';

import { splitIntoBalancedPanes, type SelfInspectionTableRow } from './selfInspectionTableModel';
import { SelfInspectionTablePane } from './SelfInspectionTablePane';

export function resolveSelfInspectionPaneCount(width: number): number {
  return width >= 1536 ? 2 : 1;
}

function useResponsivePaneCount(): number {
  const [paneCount, setPaneCount] = useState(() =>
    typeof window === 'undefined' ? 1 : resolveSelfInspectionPaneCount(window.innerWidth)
  );

  useEffect(() => {
    const update = () => setPaneCount(resolveSelfInspectionPaneCount(window.innerWidth));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return paneCount;
}

type Props = {
  rows: readonly SelfInspectionTableRow[];
  onCandidateSelect: (id: string) => void;
  onInvalidate: (row: SelfInspectionTableRow) => void;
};

export function SelfInspectionTable({ rows, onCandidateSelect, onInvalidate }: Props) {
  const paneCount = useResponsivePaneCount();
  const panes = splitIntoBalancedPanes(rows, paneCount);

  return (
    <div
      data-testid="self-inspection-table-panes"
      data-pane-count={paneCount}
      className="grid items-start gap-2"
      style={{ gridTemplateColumns: `repeat(${paneCount}, minmax(0, 1fr))` }}
    >
      {panes.map((paneRows, index) => (
        <SelfInspectionTablePane
          key={index}
          rows={paneRows}
          onCandidateSelect={onCandidateSelect}
          onInvalidate={onInvalidate}
        />
      ))}
    </div>
  );
}
