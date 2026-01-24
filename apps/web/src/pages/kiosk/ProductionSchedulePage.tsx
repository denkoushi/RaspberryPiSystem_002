import { useEffect, useMemo, useRef, useState } from 'react';

import { useCompleteKioskProductionScheduleRow, useKioskProductionSchedule } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { computeColumnWidths, type TableColumnDefinition } from '../../features/kiosk/columnWidth';
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

type NormalizedScheduleRow = {
  id: string;
  isCompleted: boolean;
  data: ScheduleRowData;
  values: Record<string, string>;
};

const SEARCH_HISTORY_KEY = 'production-schedule-search-history';

export function ProductionSchedulePage() {
  const [inputProductNo, setInputProductNo] = useState('');
  const [activeProductNo, setActiveProductNo] = useState<string>('');
  const [history, setHistory] = useLocalStorage<string[]>(SEARCH_HISTORY_KEY, []);
  const [isBlocking, setIsBlocking] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(1200);

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
  const tableColumns: TableColumnDefinition[] = useMemo(
    () => [
      { key: 'FHINCD', label: '品番' },
      { key: 'ProductNo', label: '製番' },
      { key: 'FHINMEI', label: '品名' },
      { key: 'FSIGENCD', label: '資源CD' },
      { key: 'FSIGENSHOYORYO', label: '所要', dataType: 'number' },
      { key: 'FKOJUN', label: '工順', dataType: 'number' },
      { key: 'FSEIBAN', label: '製番末尾' }
    ],
    []
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const element = containerRef.current;
    const observer = new ResizeObserver((entries) => {
      const nextWidth = Math.floor(entries[0]?.contentRect?.width ?? 0);
      if (nextWidth > 0) {
        setContainerWidth(nextWidth);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const normalizedRows = useMemo<NormalizedScheduleRow[]>(() => {
    return rows.map((r) => {
      const d = (r.rowData ?? {}) as ScheduleRowData;
      const seibanMasked = '********';
      const seibanLastDigits = String(d.FSEIBAN ?? '').slice(-3);
      const values = {
        FHINCD: String(d.FHINCD ?? ''),
        ProductNo: String(d.ProductNo ?? ''),
        FHINMEI: String(d.FHINMEI ?? ''),
        FSIGENCD: String(d.FSIGENCD ?? ''),
        FSIGENSHOYORYO: String(d.FSIGENSHOYORYO ?? ''),
        FKOJUN: String(d.FKOJUN ?? ''),
        FSEIBAN: `${seibanMasked} ${seibanLastDigits}`.trim()
      };
      return {
        id: r.id,
        isCompleted: d.progress === '完了',
        data: d,
        values
      };
    });
  }, [rows]);

  const isTwoColumn = containerWidth >= 1200;
  const itemSeparatorWidth = isTwoColumn ? 24 : 0;
  const checkWidth = 36;
  const itemWidth = isTwoColumn
    ? Math.floor((containerWidth - itemSeparatorWidth) / 2)
    : Math.floor(containerWidth);
  const itemColumnWidths = useMemo(() => {
    return computeColumnWidths({
      columns: tableColumns,
      rows: normalizedRows.map((row) => row.values),
      containerWidth: Math.max(0, itemWidth - checkWidth),
      fontSizePx: 12,
      formatCellValue: (column, value) => {
        if (column.key === 'FSEIBAN') {
          return String(value ?? '');
        }
        return String(value ?? '');
      }
    });
  }, [tableColumns, normalizedRows, itemWidth]);

  const rowPairs = useMemo(() => {
    if (!isTwoColumn) {
      return normalizedRows.map((row) => [row, undefined] as const);
    }
    const pairs: Array<[NormalizedScheduleRow, NormalizedScheduleRow | undefined]> = [];
    for (let i = 0; i < normalizedRows.length; i += 2) {
      pairs.push([normalizedRows[i], normalizedRows[i + 1]]);
    }
    return pairs;
  }, [normalizedRows, isTwoColumn]);

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
    <div className="flex h-full flex-col gap-2" ref={containerRef}>
      {isBlocking ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg bg-slate-900 px-6 py-4 text-white shadow-lg">
            <p className="text-sm font-semibold">更新中...</p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
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
          <table className="w-full border-collapse text-left text-xs text-white">
            <colgroup>
              <col style={{ width: checkWidth }} />
              {itemColumnWidths.map((width, index) => (
                <col key={`left-${tableColumns[index]?.key ?? index}`} style={{ width }} />
              ))}
              {isTwoColumn ? <col style={{ width: itemSeparatorWidth }} /> : null}
              {isTwoColumn
                ? [<col key="right-check" style={{ width: checkWidth }} />]
                    .concat(
                      itemColumnWidths.map((width, index) => (
                        <col key={`right-${tableColumns[index]?.key ?? index}`} style={{ width }} />
                      ))
                    )
                : null}
            </colgroup>
            <thead className="sticky top-0 bg-slate-900">
              <tr className="border-b border-white/20 text-xs font-semibold text-white/80">
                <th className="px-2 py-2 text-center">完了</th>
                {tableColumns.map((column) => (
                  <th key={`head-left-${column.key}`} className="px-2 py-2">
                    {column.label}
                  </th>
                ))}
                {isTwoColumn ? <th aria-hidden className="px-2 py-2" /> : null}
                {isTwoColumn ? <th className="px-2 py-2 text-center">完了</th> : null}
                {isTwoColumn
                  ? tableColumns.map((column) => (
                      <th key={`head-right-${column.key}`} className="px-2 py-2">
                        {column.label}
                      </th>
                    ))
                  : null}
              </tr>
            </thead>
            <tbody>
              {rowPairs.map(([left, right]) => {
                const leftClass = left?.isCompleted ? 'opacity-50 grayscale' : '';
                const rightClass = right?.isCompleted ? 'opacity-50 grayscale' : '';
                return (
                  <tr key={`row-${left.id}`} className="border-b border-white/10">
                    <td className={`px-2 py-1 align-middle ${leftClass}`}>
                      <button
                        className={`flex h-7 w-7 items-center justify-center rounded-full text-white shadow hover:opacity-80 disabled:opacity-60 ${
                          left.isCompleted ? 'bg-gray-500 hover:bg-gray-600' : 'bg-red-600 hover:bg-red-700'
                        }`}
                        aria-label={left.isCompleted ? '未完了に戻す' : '完了にする'}
                        onClick={() => handleComplete(left.id)}
                        disabled={isBlocking || completeMutation.isPending}
                      >
                        ✓
                      </button>
                    </td>
                    {tableColumns.map((column) => (
                      <td key={`left-${left.id}-${column.key}`} className={`px-2 py-1 ${leftClass}`}>
                        <span className={column.key === 'ProductNo' || column.key === 'FSIGENCD' ? 'font-mono' : ''}>
                          {left.values[column.key] || '-'}
                        </span>
                      </td>
                    ))}
                    {isTwoColumn ? <td className="px-2 py-1" /> : null}
                    {isTwoColumn ? (
                      <>
                        <td className={`px-2 py-1 align-middle ${rightClass}`}>
                          {right ? (
                            <button
                              className={`flex h-7 w-7 items-center justify-center rounded-full text-white shadow hover:opacity-80 disabled:opacity-60 ${
                                right.isCompleted ? 'bg-gray-500 hover:bg-gray-600' : 'bg-red-600 hover:bg-red-700'
                              }`}
                              aria-label={right.isCompleted ? '未完了に戻す' : '完了にする'}
                              onClick={() => handleComplete(right.id)}
                              disabled={isBlocking || completeMutation.isPending}
                            >
                              ✓
                            </button>
                          ) : null}
                        </td>
                        {tableColumns.map((column) => (
                          <td key={`right-${right?.id ?? 'empty'}-${column.key}`} className={`px-2 py-1 ${rightClass}`}>
                            {right ? (
                              <span
                                className={column.key === 'ProductNo' || column.key === 'FSIGENCD' ? 'font-mono' : ''}
                              >
                                {right.values[column.key] || '-'}
                              </span>
                            ) : null}
                          </td>
                        ))}
                      </>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

