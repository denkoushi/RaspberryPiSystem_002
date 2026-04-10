import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getMobilePlacementSchedule, type ProductionScheduleRow } from '../../api/client';
import { Button } from '../../components/ui/Button';

export function MobilePlacementPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');

  const queryKey = useMemo(() => ['mobile-placement-schedule', q] as const, [q]);

  const listQuery = useQuery({
    queryKey,
    queryFn: () =>
      getMobilePlacementSchedule({
        q: q.trim().length > 0 ? q.trim() : undefined,
        page: 1,
        pageSize: 100
      })
  });

  const onSelectRow = (row: ProductionScheduleRow) => {
    navigate('/kiosk/mobile-placement/register', { state: { row } });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 text-sm text-white/80">
          検索（製番・品番など）
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="rounded-md border border-white/15 bg-slate-900 px-3 py-2 text-white"
            placeholder="カンマ区切り可"
          />
        </label>
        <Button
          type="button"
          variant="ghostOnDark"
          className="shrink-0"
          onClick={() => listQuery.refetch()}
          disabled={listQuery.isFetching}
        >
          再読込
        </Button>
        <Button
          type="button"
          variant="ghostOnDark"
          className="shrink-0"
          onClick={() => navigate('/kiosk/mobile-placement/register', { state: {} })}
        >
          スケジュールなしで配置
        </Button>
      </div>

      {listQuery.isError ? (
        <p className="text-sm text-red-300" role="alert">
          一覧の取得に失敗しました。ネットワークと clientKey を確認してください。
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-white/10">
        <ul className="divide-y divide-white/10">
          {(listQuery.data?.rows ?? []).map((row) => {
            const rd = row.rowData as Record<string, unknown>;
            const productNo = typeof rd.ProductNo === 'string' ? rd.ProductNo : '';
            const fseiban = typeof rd.FSEIBAN === 'string' ? rd.FSEIBAN : '';
            const fhincd = typeof rd.FHINCD === 'string' ? rd.FHINCD : '';
            const fhinmei = typeof rd.FHINMEI === 'string' ? rd.FHINMEI : '';
            return (
              <li key={row.id}>
                <button
                  type="button"
                  className="flex w-full flex-col gap-0.5 px-3 py-3 text-left text-sm hover:bg-white/5"
                  onClick={() => onSelectRow(row)}
                >
                  <span className="font-medium text-white">
                    {fseiban || productNo || '（行ID）'} {fhincd ? `· ${fhincd}` : ''}
                  </span>
                  {fhinmei ? <span className="text-xs text-white/70">{fhinmei}</span> : null}
                  {productNo && productNo !== fseiban ? (
                    <span className="text-xs text-white/50">製番 {productNo}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        {!listQuery.isLoading && (listQuery.data?.rows.length ?? 0) === 0 ? (
          <p className="p-4 text-sm text-white/60">行がありません。検索条件を変えてください。</p>
        ) : null}
        {listQuery.isLoading ? <p className="p-4 text-sm text-white/60">読み込み中…</p> : null}
      </div>
    </div>
  );
}
