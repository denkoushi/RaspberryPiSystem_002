import clsx from 'clsx';

import type { ProductionScheduleRow } from '../../../api/client';

type Props = {
  total: number;
  rows: ProductionScheduleRow[];
  representativeLimit: number;
  className?: string;
};

function formatEvidenceLine(row: ProductionScheduleRow): string {
  const evidence = row.processChangeResidualEvidence;
  if (!evidence) {
    const data = row.rowData as Record<string, unknown>;
    const resourceCd = typeof data.FSIGENCD === 'string' ? data.FSIGENCD : '?';
    const productNo = typeof data.ProductNo === 'string' ? data.ProductNo : '?';
    const fkojun = typeof data.FKOJUN === 'string' ? data.FKOJUN : '?';
    return `${resourceCd} / ${productNo} / 工順 ${fkojun}`;
  }
  const { current, completedOtherResource } = evidence;
  return `${current.resourceCd} / ${current.productNo} / 工順 ${current.fkojun}（別資源 ${completedOtherResource.resourceCd}=${completedOtherResource.status}）`;
}

export function LeaderBoardProcessChangeResidualSummary({
  total,
  rows,
  representativeLimit,
  className
}: Props) {
  if (total <= 0) {
    return null;
  }

  const shownCount = rows.length;
  const hiddenCount = Math.max(0, total - shownCount);

  return (
    <section
      className={clsx(
        'mb-2 shrink-0 rounded-md border border-amber-400/35 bg-amber-950/35 px-3 py-2 text-sm text-amber-50/95',
        className
      )}
      aria-label="工程変更残骸疑い"
    >
      <p className="font-medium">
        工程変更残骸疑い {total} 件（完了扱いではありません）
      </p>
      <p className="mt-1 text-xs text-amber-100/80">
        同じ ProductNo + 工順で別資源の完了履歴があるため、通常順位から分離しています。
      </p>
      {shownCount > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-amber-50/90">
          {rows.map((row) => (
            <li key={row.id}>{formatEvidenceLine(row)}</li>
          ))}
        </ul>
      ) : null}
      {hiddenCount > 0 ? (
        <p className="mt-1 text-xs text-amber-100/75">
          ほか {hiddenCount} 件（代表表示上限 {representativeLimit} 件）
        </p>
      ) : null}
    </section>
  );
}
