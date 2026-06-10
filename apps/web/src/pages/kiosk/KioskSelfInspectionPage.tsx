import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { useKioskProductionSchedule, useSelfInspectionSessions } from '../../api/hooks';
import { buttonClassName, Button } from '../../components/ui/Button';
import { kioskSelfInspectionSessionPath } from '../../features/part-measurement/selfInspectionRoutes';

import type { ProductionScheduleRow } from '../../api/client';
import type { SelfInspectionSessionSummaryDto } from '../../features/part-measurement/types';

const CANDIDATE_PAGE_SIZE = 50;
const CANDIDATE_SEARCH_DEBOUNCE_MS = 400;
const WIP_REFETCH_INTERVAL_MS = 60_000;
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

function formatSessionProgress(session: SelfInspectionSessionSummaryDto): string {
  const completed = session.completedEntryCount;
  const required = session.requiredEntryCount;
  return `${completed} / ${required} 件`;
}

function SessionWipCard({ session }: { session: SelfInspectionSessionSummaryDto }) {
  return (
    <section className="grid gap-2 rounded border border-white/15 bg-slate-900/80 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-lg font-bold">{session.productNo}</p>
          <p className="text-sm text-white/70">
            {session.fhincd} / {session.fhinmei} / {session.resourceCd} / 指示数 {session.plannedQuantity}
          </p>
          {session.fseiban ? <p className="text-xs text-white/55">製番 {session.fseiban}</p> : null}
        </div>
        <span className="rounded bg-yellow-400/20 px-2 py-1 text-xs font-semibold text-yellow-200">入力中</span>
      </div>
      <p className="text-xs text-white/55">進捗 {formatSessionProgress(session)}</p>
      <div className="flex flex-wrap gap-2">
        <Link
          to={kioskSelfInspectionSessionPath(session.id)}
          className={buttonClassName('primary', 'inline-flex min-h-11 items-center text-[1rem]')}
        >
          再開
        </Link>
      </div>
    </section>
  );
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
  const immediateSearch = productNo.trim();
  const immediateResourceCd = resourceCd.trim();
  const hasSearchInput = immediateSearch.length > 0 || immediateResourceCd.length > 0;
  const hasResourceFilter = trimmedResourceCd.length > 0;
  const hasTextFilter =
    trimmedSearch.length >= CANDIDATE_MIN_TEXT_SEARCH_LENGTH ||
    (trimmedSearch.length > 0 && hasResourceFilter);
  const hasListFilters = hasTextFilter || hasResourceFilter;
  const isTextSearchTooShort =
    immediateSearch.length > 0 &&
    immediateSearch.length < CANDIDATE_MIN_TEXT_SEARCH_LENGTH &&
    immediateResourceCd.length === 0;

  const wipSessionsQuery = useSelfInspectionSessions(
    { status: 'in_progress' },
    { enabled: !hasSearchInput, refetchIntervalMs: WIP_REFETCH_INTERVAL_MS }
  );

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

  const wipSessions = wipSessionsQuery.data?.sessions ?? [];
  const wipListTruncated = wipSessionsQuery.data?.truncated === true;
  const wipListLimit = wipSessionsQuery.data?.listLimit ?? 200;
  const hasMore = scheduleQuery.data?.hasMore === true;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 bg-slate-800 p-3 text-white">
      <div className="rounded border border-white/15 bg-slate-900/70 p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">自主検査</h1>
            <p className="mt-1 text-sm text-white/70">
              仕掛中（全端末共通）を表示します。検索で新規開始の候補を絞り込めます。
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-end gap-2">
            <label className="grid min-w-[12rem] max-w-xs flex-1 gap-1 text-sm">
              <span className="text-white/70">製造order / 製番 / 品番</span>
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
            <label className="grid w-[7rem] gap-1 text-sm">
              <span className="text-white/70">資源CD</span>
              <input
                className="rounded border border-white/15 bg-slate-950/70 px-3 py-2 text-white"
                value={resourceCd}
                onChange={(e) => {
                  setResourceCd(e.target.value);
                  setPage(1);
                }}
                placeholder="581"
              />
            </label>
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
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded border border-white/15 bg-slate-950/45 p-3">
        {hasSearchInput ? (
          isTextSearchTooShort ? (
            <div className="py-12 text-center text-white/60">
              製造order・製番・品番は {CANDIDATE_MIN_TEXT_SEARCH_LENGTH} 文字以上で検索してください（資源CD のみでも可）。
            </div>
          ) : !hasListFilters ? (
            <div className="py-12 text-center text-white/60">検索候補を読込中…</div>
          ) : scheduleQuery.isLoading && rows.length === 0 ? (
            <div className="py-12 text-center text-white/60">検索候補を読込中…</div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-white/60">
              {hasMore
                ? 'さらに検索しています。条件を絞るか、しばらくしてから再度お試しください。'
                : '自主検査対象の候補がありません。'}
            </div>
          ) : (
            <>
              <p className="mb-2 text-xs text-white/55">検索結果（開始 / 再開候補）</p>
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
          )
        ) : wipSessionsQuery.isLoading && wipSessions.length === 0 ? (
          <div className="py-12 text-center text-white/60">仕掛中を読込中…</div>
        ) : wipSessions.length === 0 ? (
          <div className="py-12 text-center text-white/60">
            仕掛中の自主検査はありません。検索して新規開始できます。
          </div>
        ) : (
          <>
            <p className="mb-2 text-xs text-white/55">仕掛中（更新の新しい順・全端末共通）</p>
            {wipListTruncated ? (
              <p className="mb-2 rounded border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                仕掛中は最新 {wipListLimit} 件まで表示しています。それより古いセッションは検索で絞り込んでください。
              </p>
            ) : null}
            <div className="grid gap-2">
              {wipSessions.map((session) => (
                <SessionWipCard key={session.id} session={session} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
