import { SelfInspectionTableItem } from './SelfInspectionTableItem';

import type { SelfInspectionTableRow } from './selfInspectionTableModel';

type Props = {
  rows: readonly SelfInspectionTableRow[];
  onCandidateSelect: (id: string) => void;
  onInvalidate: (row: SelfInspectionTableRow) => void;
};

export function SelfInspectionTablePane({ rows, onCandidateSelect, onInvalidate }: Props) {
  return (
    <div
      data-testid="self-inspection-table-pane"
      className="min-w-0 overflow-hidden rounded border border-white/15 bg-slate-950/55"
    >
      <table className="w-full table-fixed border-collapse text-left text-sm text-white">
        <caption className="sr-only">
          自主検査一覧。製番、機種名、品名、状態、次の操作を表示します。
        </caption>
        <colgroup>
          <col className="w-1/4" />
          <col className="w-1/4" />
          <col className="w-1/4" />
          <col className="w-1/4" />
        </colgroup>
        <thead className="sr-only">
          <tr>
            <th scope="col">製番</th>
            <th scope="col">機種名</th>
            <th scope="col">品名・状態</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <SelfInspectionTableItem
              key={`${row.kind}:${row.id}`}
              row={row}
              onCandidateSelect={onCandidateSelect}
              onInvalidate={onInvalidate}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
