import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { useKioskProductionSchedule } from '../../api/hooks';
import { buttonClassName, Button } from '../../components/ui/Button';

import type { ProductionScheduleRow } from '../../api/client';

const CANDIDATE_PAGE_SIZE = 50;
const CANDIDATE_SEARCH_DEBOUNCE_MS = 400;
/** 製番・品番テキストのみのときは API 走査を避けるための最小文字数（資源CD 併用時は不要） */
const CANDIDATE_MIN_TEXT_SEARCH_LENGTH = 2;

function mapEligibleRow(row: ProductionScheduleRow) {
  const rowData = (row.rowData ?? {}) as Record<string, unknown>;
  const entryPath = row.selfInspectionEntryPath?.trim() ?? '';
  const plannedQuantity =
    typeof row.plannedQuantity === 'number' && Number.isFinite(row.plannedQuantity) && row.plannedQuantity >= 1
      ? Math.floor(row.plannedQuantity)
      : null;
  return {
    id: row.id,
    productNo: String(rowData.ProductNo ?? '').trim(),
    fseiban: String(rowData.FSEIBAN ?? '').trim(),
    resourceCd: String(rowData.FSIGENCD ?? '').trim(),
    fhincd: String(rowData.FHINCD ?? '').trim(),
    fhinmei: String(rowData.FHINMEI ?? '').trim(),
    plannedQuantity,
    entryPath,
    status: row.selfInspectionStatus ?? null
  };
}

function statusLabel(status: 'not_started' | 'in_progress' | 'completed' | null) {
  if (status === 'completed') return '完了';
  if (status === 'in_progress') return '入力中';
  return '未開始';
}

export function KioskSelfInspectionPage() {
  const [productNo, setProductNo] = useState('');
  const [resourceCd, setResourceCd] = useState('');
  const [debouncedProductNo, setDebouncedProductNo] = useState('');
  const [debouncedResourceCd, setDebouncedResourceCd] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedProductNo(productNo.trim());
      setDebouncedResourceCd(resourceCd.trim());
    }, CANDIDATE_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [productNo, resourceCd]);

  const trimmedSearch = debouncedProductNo;
  const trimmedResourceCd = debouncedResourceCd;
  const hasResourceFilter = trimmedResourceCd.length > 0;
  const hasTextFilter =
    trimmedSearch.length >= CANDIDATE_MIN_TEXT_SEARCH_LENGTH ||
    (trimmedSearch.length > 0 && hasResourceFilter);
  const hasListFilters = hasTextFilter || hasResourceFilter;
  const isTextSearchTooShort =
    trimmedSearch.length > 0 && trimmedSearch.length < CANDIDATE_MIN_TEXT_SEARCH_LENGTH && !hasResourceFilter;

  const scheduleQuery = useKioskProductionSchedule(
    {
      q: trimmedSearch || undefined,
      resourceCds: trimmedResourceCd || undefined,
      page,
      pageSize: CANDIDATE_PAGE_SIZE,
      allowResourceOnly: true,
      selfInspectionEligibleOnly: true
    },
    {
      enabled: hasListFilters,
      refetchIntervalMs: hasListFilters ? 60_000 : false
    }
  );

  const rows = useMemo(
    () => (scheduleQuery.data?.rows ?? []).map(mapEligibleRow).filter((row) => row.entryPath.length > 0),
    [scheduleQuery.data?.rows]
  );

  const hasMore = scheduleQuery.data?.hasMore === true;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 bg-slate-800 p-3 text-white">
      <div className="rounded border border-white/15 bg-slate-900/70 p-3">
        <h1 className="text-2xl font-bold">自主検査</h1>
        <p className="mt-1 text-sm text-white/70">対象の生産アイテムを選び、登録済みの検査図面で自主検査を開始します。</p>
      </div>

      <div className="grid gap-2 rounded border border-white/15 bg-slate-900/60 p-3 md:grid-cols-[1fr_180px_auto]">
        <label className="grid gap-1 text-sm">
          製造order / 製番 / 品番検索
          <input
            className="rounded border border-white/15 bg-slate-950/70 px-3 py-2 text-white"
            value={productNo}
            onChange={(e) => {
              setProductNo(e.target.value);
              setPage(1);
            }}
            placeholder="製造order・製番・品番"
          />
        </label>
        <label className="grid gap-1 text-sm">
          資源CD
          <input
            className="rounded border border-white/15 bg-slate-950/70 px-3 py-2 text-white"
            value={resourceCd}
            onChange={(e) => {
              setResourceCd(e.target.value);
              setPage(1);
            }}
            placeholder="例: 581"
          />
        </label>
        <div className="flex items-end">
          <Button
            type="button"
            variant="ghostOnDark"
            onClick={() => {
              setProductNo('');
              setResourceCd('');
              setPage(1);
            }}
          >
            クリア
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded border border-white/15 bg-slate-950/45 p-3">
        {isTextSearchTooShort ? (
          <div className="py-12 text-center text-white/60">
            製造order・製番・品番は {CANDIDATE_MIN_TEXT_SEARCH_LENGTH} 文字以上で検索してください（資源CD のみでも可）。
          </div>
        ) : !hasListFilters ? (
          <div className="py-12 text-center text-white/60">
            製造order・製番・品番、または資源CDのいずれかを入力して候補を表示してください。
          </div>
        ) : scheduleQuery.isLoading && rows.length === 0 ? (
          <div className="py-12 text-center text-white/60">読込中…</div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-white/60">
            {hasMore
              ? 'さらに検索しています。条件を絞るか、しばらくしてから再度お試しください。'
              : '自主検査対象の候補がありません。'}
          </div>
        ) : (
          <>
            <p className="mb-2 text-xs text-white/55">
              {page} ページ目（1 ページ {CANDIDATE_PAGE_SIZE} 件）
              {hasMore ? ' — さらに候補がある可能性があります' : ''}
            </p>
            <div className="grid gap-2">
              {rows.map((row) => (
                <section key={row.id} className="grid gap-2 rounded border border-white/15 bg-slate-900/80 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-lg font-bold">{row.productNo}</p>
                      <p className="text-sm text-white/70">
                        {row.fhincd} / {row.fhinmei} / {row.resourceCd} / 指示数{' '}
                        {row.plannedQuantity ?? '—'}
                      </p>
                      <p className="text-xs text-white/55">製番 {row.fseiban}</p>
                    </div>
                    {row.status ? (
                      <span className="rounded bg-cyan-500/20 px-2 py-1 text-xs font-semibold text-cyan-200">
                        {statusLabel(row.status)}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      to={row.entryPath}
                      className={buttonClassName(
                        row.status === 'in_progress' || row.status === 'completed' ? 'primary' : 'ghostOnDark',
                        'inline-flex min-h-11 items-center text-[1rem]'
                      )}
                    >
                      {row.status === 'in_progress' || row.status === 'completed' ? '再開' : '開始'}
                    </Link>
                  </div>
                </section>
              ))}
            </div>
            {hasMore || page > 1 ? (
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Button
                  type="button"
                  variant="ghostOnDark"
                  disabled={page <= 1 || scheduleQuery.isFetching}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  前のページ
                </Button>
                <Button
                  type="button"
                  variant="ghostOnDark"
                  disabled={!hasMore || scheduleQuery.isFetching}
                  onClick={() => setPage((current) => current + 1)}
                >
                  次のページ
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
