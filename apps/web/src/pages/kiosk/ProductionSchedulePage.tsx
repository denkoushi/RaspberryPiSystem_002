import { useMemo, useState } from 'react';

import { useCompleteKioskProductionScheduleRow, useKioskProductionSchedule } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useLocalStorage } from '../../hooks/useLocalStorage';

type ScheduleRowData = {
  ProductNo?: string;
  FSEIBAN?: string;
  FHINCD?: string;
  FHINMEI?: string;
  FSIGENCD?: string;
  FSIGENSHOYORYO?: string | number;
  FKOJUN?: string | number;
  progress?: string;
};

const SEARCH_HISTORY_KEY = 'production-schedule-search-history';

export function ProductionSchedulePage() {
  const [inputProductNo, setInputProductNo] = useState('');
  const [activeProductNo, setActiveProductNo] = useState<string>('');
  const [history, setHistory] = useLocalStorage<string[]>(SEARCH_HISTORY_KEY, []);
  const [isBlocking, setIsBlocking] = useState(false);

  const queryParams = useMemo(
    () => ({
      productNo: activeProductNo.length > 0 ? activeProductNo : undefined,
      page: 1,
      pageSize: 2000
    }),
    [activeProductNo]
  );
  const scheduleQuery = useKioskProductionSchedule(queryParams);
  const completeMutation = useCompleteKioskProductionScheduleRow();

  const rows = scheduleQuery.data?.rows ?? [];

  const applySearch = (value: string) => {
    const trimmed = value.trim();
    setActiveProductNo(trimmed);
    setInputProductNo(trimmed);
    if (trimmed.length > 0) {
      setHistory((prev) => {
        const next = [trimmed, ...prev.filter((p) => p !== trimmed)].slice(0, 8);
        return next;
      });
    }
  };

  const handleComplete = async (rowId: string) => {
    setIsBlocking(true);
    try {
      await completeMutation.mutateAsync(rowId);
      await scheduleQuery.refetch();
    } finally {
      setIsBlocking(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      {isBlocking ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg bg-slate-900 px-6 py-4 text-white shadow-lg">
            <p className="text-sm font-semibold">更新中...</p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={inputProductNo}
            onChange={(e) => setInputProductNo(e.target.value)}
            placeholder="製番(ProductNo)で検索"
            className="h-10 w-64 bg-white text-slate-900"
          />
          <Button
            variant="primary"
            className="h-10"
            onClick={() => applySearch(inputProductNo)}
            disabled={scheduleQuery.isFetching || completeMutation.isPending}
          >
            検索
          </Button>
          <Button
            variant="ghost"
            className="h-10"
            onClick={() => applySearch('')}
            disabled={scheduleQuery.isFetching || completeMutation.isPending}
          >
            クリア
          </Button>
          {scheduleQuery.isFetching ? <span className="text-xs text-white/70">更新中...</span> : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {history.map((h) => (
            <button
              key={h}
              className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/20"
              onClick={() => applySearch(h)}
            >
              {h}
            </button>
          ))}
        </div>
      </div>

      {scheduleQuery.isLoading ? (
        <p className="text-sm font-semibold text-white/80">読み込み中...</p>
      ) : scheduleQuery.isError ? (
        <p className="text-sm font-semibold text-rose-300">取得に失敗しました。</p>
      ) : rows.length === 0 ? (
        <p className="text-sm font-semibold text-white/80">仕掛中のデータはありません。</p>
      ) : (
        <div className="flex-1 overflow-auto">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
            {rows.map((r) => {
              const d = (r.rowData ?? {}) as ScheduleRowData;
              const hinCd = String(d.FHINCD ?? '');
              const seibanMasked = '********';
              const productNo = String(d.ProductNo ?? '');
              const shigenCd = String(d.FSIGENCD ?? '');
              const hinMei = String(d.FHINMEI ?? '');
              const shoyoryo = d.FSIGENSHOYORYO ?? '';
              const kojun = d.FKOJUN ?? '';

              return (
                <div key={r.id} className="relative rounded-lg border border-white/20 bg-white text-slate-900 shadow">
                  <button
                    className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-red-600 text-white shadow hover:bg-red-700 disabled:opacity-60"
                    aria-label="完了にする"
                    onClick={() => handleComplete(r.id)}
                    disabled={isBlocking || completeMutation.isPending}
                  >
                    ✓
                  </button>

                  <div className="px-3 pt-3">
                    <div className="flex items-start justify-between gap-2 pr-10">
                      <div className="text-sm font-bold text-slate-900">{hinCd}</div>
                      <div className="text-xs font-mono font-semibold text-slate-700">{seibanMasked}</div>
                    </div>

                    <div className="mt-1 flex items-center justify-between text-xs text-slate-700">
                      <div className="font-mono font-semibold">{productNo}</div>
                      <div className="font-mono font-semibold">{shigenCd}</div>
                    </div>

                    <div className="mt-2 min-h-[2.25rem] text-sm font-semibold text-slate-900">{hinMei}</div>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2 bg-red-600 px-3 py-2 text-white">
                    <div className="text-xs">
                      <div className="opacity-90">所要</div>
                      <div className="text-sm font-bold">{String(shoyoryo)}</div>
                    </div>
                    <div className="text-xs text-right">
                      <div className="opacity-90">工順</div>
                      <div className="text-sm font-bold">{String(kojun)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

