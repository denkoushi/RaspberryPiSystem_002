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
  const [inputQuery, setInputQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState<string>('');
  const [history, setHistory] = useLocalStorage<string[]>(SEARCH_HISTORY_KEY, []);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(1200);

  const queryParams = useMemo(
    () => ({
      q: activeQuery.length > 0 ? activeQuery : undefined,
      page: 1,
      pageSize: 400
    }),
    [activeQuery]
  );
  const hasQuery = activeQuery.trim().length > 0;
  const scheduleQuery = useKioskProductionSchedule(queryParams, { enabled: hasQuery });
  const completeMutation = useCompleteKioskProductionScheduleRow();

  const tableColumns: TableColumnDefinition[] = useMemo(
    () => [
      { key: 'FHINCD', label: '品番' },
      { key: 'ProductNo', label: '製造order番号' },
      { key: 'FHINMEI', label: '品名' },
      { key: 'FSIGENCD', label: '資源CD' },
      { key: 'FSIGENSHOYORYO', label: '所要', dataType: 'number' },
      { key: 'FKOJUN', label: '工順', dataType: 'number' },
      { key: 'FSEIBAN', label: '製番' }
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
    const sourceRows = scheduleQuery.data?.rows ?? [];
    return sourceRows.map((r) => {
      const d = (r.rowData ?? {}) as ScheduleRowData;
      const values = {
        FHINCD: String(d.FHINCD ?? ''),
        ProductNo: String(d.ProductNo ?? ''),
        FHINMEI: String(d.FHINMEI ?? ''),
        FSIGENCD: String(d.FSIGENCD ?? ''),
        FSIGENSHOYORYO: String(d.FSIGENSHOYORYO ?? ''),
        FKOJUN: String(d.FKOJUN ?? ''),
        FSEIBAN: String(d.FSEIBAN ?? '')
      };
      return {
        id: r.id,
        isCompleted: d.progress === '完了',
        data: d,
        values
      };
    });
  }, [scheduleQuery.data?.rows]);

  const isTwoColumn = containerWidth >= 1200;
  const itemSeparatorWidth = isTwoColumn ? 24 : 0;
  const checkWidth = 36;
  const itemWidth = isTwoColumn
    ? Math.floor((containerWidth - itemSeparatorWidth) / 2)
    : Math.floor(containerWidth);
  const widthSampleRows = useMemo(
    () => normalizedRows.slice(0, 80).map((row) => row.values),
    [normalizedRows]
  );
  const itemColumnWidths = useMemo(() => {
    return computeColumnWidths({
      columns: tableColumns,
      rows: widthSampleRows,
      containerWidth: Math.max(0, itemWidth - checkWidth),
      fontSizePx: 12,
      formatCellValue: (column, value) => {
        if (column.key === 'FSEIBAN') {
          return String(value ?? '');
        }
        return String(value ?? '');
      }
    });
  }, [tableColumns, widthSampleRows, itemWidth]);

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
    setActiveQuery(trimmed);
    setInputQuery(trimmed);
    if (trimmed.length > 0) {
      setHistory((prev) => {
        const next = [trimmed, ...prev.filter((p) => p !== trimmed)].slice(0, 8);
        return next;
      });
    }
  };

  const handleComplete = async (rowId: string) => {
    // Optimistic Updateにより、UIは即座に更新される
    await completeMutation.mutateAsync(rowId);
  };

  return (
    <div className="flex h-full flex-col gap-2" ref={containerRef}>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            placeholder="製造order番号 / 製番で検索"
            className="h-10 w-64 bg-white text-slate-900"
          />
          <Button
            variant="primary"
            className="h-10"
            onClick={() => applySearch(inputQuery)}
            disabled={scheduleQuery.isFetching || completeMutation.isPending}
          >
            検索
          </Button>
          <Button
            variant="secondary"
            className="h-10"
            onClick={() => applySearch('')}
            disabled={scheduleQuery.isFetching || completeMutation.isPending}
          >
            クリア
          </Button>
          {hasQuery && scheduleQuery.isFetching ? <span className="text-xs text-white/70">更新中...</span> : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {history.map((h) => (
            <div
              key={h}
              role="button"
              tabIndex={0}
              onClick={() => applySearch(h)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  applySearch(h);
                }
              }}
              className="relative cursor-pointer rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/20"
            >
              {h}
              <button
                type="button"
                aria-label={`履歴から削除: ${h}`}
                className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-[10px] font-bold text-slate-900 shadow hover:bg-amber-300"
                onClick={(event) => {
                  event.stopPropagation();
                  setHistory((prev) => prev.filter((item) => item !== h));
                  if (activeQuery === h) {
                    setActiveQuery('');
                    setInputQuery('');
                  }
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {!hasQuery ? (
        <p className="text-sm font-semibold text-white/80">検索してください。</p>
      ) : scheduleQuery.isLoading ? (
        <p className="text-sm font-semibold text-white/80">読み込み中...</p>
      ) : scheduleQuery.isError ? (
        <p className="text-sm font-semibold text-rose-300">取得に失敗しました。</p>
      ) : normalizedRows.length === 0 ? (
        <p className="text-sm font-semibold text-white/80">該当するデータはありません。</p>
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
                        disabled={completeMutation.isPending}
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
                              disabled={completeMutation.isPending}
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

