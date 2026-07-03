import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { issueSelfInspectionPaperReport } from '../../api/client';
import {
  useKioskProductionSchedule,
  useSelfInspectionSessions
} from '../../api/hooks';
import { buttonClassName, Button } from '../../components/ui/Button';
import { useKeyboardWedgeScan } from '../../features/barcode-scan';
import {
  kioskButtonPrimaryClassName,
  kioskButtonSecondaryClassName,
  kioskInputClassName,
  kioskMetaTextClassName,
  kioskPageTitleClassName,
  kioskPanelClassName
} from '../../features/kiosk/kioskTheme';
import { kioskInspectionDrawingPaperReportPrintPath } from '../../features/part-measurement/inspection-drawing/kioskInspectionDrawingRoutes';
import { normalizeManufacturingOrderScanText } from '../../features/part-measurement/manufacturingOrderScan';
import {
  KIOSK_SELF_INSPECTION_RECORD_APPROVALS_PATH,
  kioskSelfInspectionInspectorSessionPath,
  kioskSelfInspectionSessionPath
} from '../../features/part-measurement/selfInspectionRoutes';
import { presentSelfInspectionWipCard } from '../../features/part-measurement/selfInspectionWipCardPresentation';
import {
  SelfInspectionWorkflowModal,
  type SelfInspectionWorkflowTarget
} from '../../features/part-measurement/SelfInspectionWorkflowModal';

import type { ProductionScheduleRow } from '../../api/client';
import type { SelfInspectionSessionSummaryDto, SelfInspectionStatus } from '../../features/part-measurement/types';

const CANDIDATE_PAGE_SIZE = 50;
const CANDIDATE_SEARCH_DEBOUNCE_MS = 400;
const WIP_REFETCH_INTERVAL_MS = 60_000;
/** 製番・品番テキストのみのときは API 走査を避けるための最小文字数（資源CD 併用時は不要） */
const CANDIDATE_MIN_TEXT_SEARCH_LENGTH = 2;

type ScanStatus = {
  kind: 'waiting' | 'success' | 'error';
  message: string;
};

type SelfInspectionCandidateRow = SelfInspectionWorkflowTarget & {
  id: string;
  plannedQuantity: number | null;
  status: SelfInspectionStatus | null;
};

function mapEligibleRow(row: ProductionScheduleRow): SelfInspectionCandidateRow {
  const rowData = (row.rowData ?? {}) as Record<string, unknown>;
  const entryPath = row.selfInspectionEntryPath?.trim() ?? '';
  const templateId = row.selfInspectionTemplateId?.trim() ?? '';
  const plannedQuantity =
    typeof row.plannedQuantity === 'number' && Number.isFinite(row.plannedQuantity) && row.plannedQuantity >= 1
      ? Math.floor(row.plannedQuantity)
      : null;
  return {
    id: row.id,
    scheduleRowId: row.id,
    productNo: String(rowData.ProductNo ?? '').trim(),
    fseiban: String(rowData.FSEIBAN ?? '').trim(),
    resourceCd: String(rowData.FSIGENCD ?? '').trim(),
    fhincd: String(rowData.FHINCD ?? '').trim(),
    fhinmei: String(rowData.FHINMEI ?? '').trim(),
    machineName: typeof row.resolvedMachineName === 'string' ? row.resolvedMachineName.trim() : null,
    plannedQuantity,
    selfInspectionTemplateId: templateId.length > 0 ? templateId : null,
    selfInspectionEntryPath: entryPath.length > 0 ? entryPath : null,
    status: row.selfInspectionStatus ?? null
  };
}

function getPaperReportIssueErrorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'response' in error
    ? ((error.response as { data?: { message?: string } } | undefined)?.data?.message ??
      '紙帳票の発行に失敗しました。')
    : '紙帳票の発行に失敗しました。';
}

function statusLabel(status: SelfInspectionStatus | null) {
  if (status === 'completed') return '完了';
  if (status === 'review_pending') return '承認待ち';
  if (status === 'in_progress') return '入力中';
  return '未開始';
}

function SessionWipCard({ session }: { session: SelfInspectionSessionSummaryDto }) {
  const inspectorState = session.inspectorMeasurementState;
  const isInspectorRemeasurementActive =
    Boolean(session.inspectorRemeasurementRequiredAt) &&
    (inspectorState === 'pending' || inspectorState === 'in_progress');
  const isInspectorRemeasurementComplete =
    Boolean(session.inspectorRemeasurementRequiredAt) && inspectorState === 'complete';
  const actionPath = isInspectorRemeasurementActive
    ? kioskSelfInspectionInspectorSessionPath(session.id)
    : isInspectorRemeasurementComplete && session.recordApprovalRequiredAt
      ? KIOSK_SELF_INSPECTION_RECORD_APPROVALS_PATH
      : kioskSelfInspectionSessionPath(session.id);
  const actionLabel = isInspectorRemeasurementActive
    ? '検査員測定'
    : isInspectorRemeasurementComplete && session.recordApprovalRequiredAt
      ? '記録確認'
      : '再開';
  const badgeLabel = isInspectorRemeasurementActive
    ? '検査員待ち'
    : isInspectorRemeasurementComplete && session.recordApprovalRequiredAt
      ? '確認待ち'
      : statusLabel(session.status);
  const card = presentSelfInspectionWipCard({
    productNo: session.productNo,
    fhincd: session.fhincd,
    fhinmei: session.fhinmei,
    resourceCd: session.resourceCd,
    plannedQuantity: session.plannedQuantity,
    fseiban: session.fseiban,
    completedEntryCount: session.completedEntryCount,
    requiredEntryCount: session.requiredEntryCount,
    participantEmployeeNames: session.participantEmployeeNames ?? []
  });

  return (
    <section className={clsx(kioskPanelClassName, 'flex min-w-0 flex-col gap-1.5 p-2')}>
      <div className="flex min-w-0 items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-1 text-base font-bold" title={card.productNo}>
            {card.productNo}
          </p>
          <p className="line-clamp-2 text-xs leading-snug text-white/70" title={card.metaLine}>
            {card.metaLine}
          </p>
          {card.fseibanLine ? (
            <p className={clsx(kioskMetaTextClassName, 'line-clamp-1')} title={card.fseibanLine}>
              {card.fseibanLine}
            </p>
          ) : null}
          <p
            className={clsx(kioskMetaTextClassName, 'line-clamp-2 leading-snug')}
            title={card.participantNamesTitle ?? undefined}
          >
            氏名 {card.participantNamesLine}
          </p>
        </div>
        <span
          className={clsx(
            'shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold',
            session.status === 'review_pending' || isInspectorRemeasurementActive || isInspectorRemeasurementComplete
              ? 'bg-red-400/20 text-red-100'
              : 'bg-yellow-400/20 text-yellow-200'
          )}
        >
          {badgeLabel}
        </span>
      </div>
      <p className={kioskMetaTextClassName}>
        {isInspectorRemeasurementActive || isInspectorRemeasurementComplete
          ? `検査員 ${session.inspectorCompletedRequiredEntryCount}/${session.inspectorRequiredEntryCount} 件`
          : `進捗 ${card.progressLine}`}
      </p>
      <div className="flex flex-wrap gap-1">
        <Link
          to={actionPath}
          className={buttonClassName('primary', clsx(kioskButtonPrimaryClassName, 'inline-flex w-full items-center justify-center text-sm'))}
        >
          {actionLabel}
        </Link>
      </div>
    </section>
  );
}

export function KioskSelfInspectionPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [productNo, setProductNo] = useState('');
  const [resourceCd, setResourceCd] = useState('');
  const [debouncedProductNo, setDebouncedProductNo] = useState('');
  const [debouncedResourceCd, setDebouncedResourceCd] = useState('');
  const [scannedProductNo, setScannedProductNo] = useState('');
  const [scanArmed, setScanArmed] = useState(false);
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [inspectionWorkflowTarget, setInspectionWorkflowTarget] = useState<SelfInspectionCandidateRow | null>(null);
  const [page, setPage] = useState(1);
  const scanFocusRef = useRef<HTMLDivElement | null>(null);
  const autoOpenedScanKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedProductNo(productNo.trim());
      setDebouncedResourceCd(resourceCd.trim());
    }, CANDIDATE_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [productNo, resourceCd]);

  const trimmedSearch = debouncedProductNo;
  const trimmedResourceCd = debouncedResourceCd;
  const exactScannedProductNo = scannedProductNo.trim();
  const immediateSearch = productNo.trim();
  const immediateResourceCd = resourceCd.trim();
  const hasSearchInput = immediateSearch.length > 0 || immediateResourceCd.length > 0;
  const hasResourceFilter = trimmedResourceCd.length > 0;
  const hasScannedProductFilter = exactScannedProductNo.length > 0;
  const hasTextFilter =
    trimmedSearch.length >= CANDIDATE_MIN_TEXT_SEARCH_LENGTH ||
    (trimmedSearch.length > 0 && hasResourceFilter);
  const hasListFilters = hasScannedProductFilter || hasTextFilter || hasResourceFilter;
  const isTextSearchTooShort =
    !hasScannedProductFilter &&
    immediateSearch.length > 0 &&
    immediateSearch.length < CANDIDATE_MIN_TEXT_SEARCH_LENGTH &&
    immediateResourceCd.length === 0;

  const wipSessionsQuery = useSelfInspectionSessions(
    { status: 'in_progress' },
    { enabled: !hasSearchInput, refetchIntervalMs: WIP_REFETCH_INTERVAL_MS }
  );
  const reviewPendingSessionsQuery = useSelfInspectionSessions(
    { status: 'review_pending' },
    { enabled: !hasSearchInput, refetchIntervalMs: WIP_REFETCH_INTERVAL_MS }
  );

  const scheduleQuery = useKioskProductionSchedule(
    {
      q: hasScannedProductFilter ? undefined : trimmedSearch || undefined,
      productNos: hasScannedProductFilter ? exactScannedProductNo : undefined,
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
    () =>
      (scheduleQuery.data?.rows ?? [])
        .map(mapEligibleRow)
        .filter((row) => Boolean(row.selfInspectionEntryPath?.trim()) || Boolean(row.selfInspectionTemplateId?.trim())),
    [scheduleQuery.data?.rows]
  );

  const wipSessions = useMemo(
    () =>
      [...(reviewPendingSessionsQuery.data?.sessions ?? []), ...(wipSessionsQuery.data?.sessions ?? [])]
        .filter((session, index, sessions) => sessions.findIndex((row) => row.id === session.id) === index)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [reviewPendingSessionsQuery.data?.sessions, wipSessionsQuery.data?.sessions]
  );
  const wipListTruncated =
    wipSessionsQuery.data?.truncated === true || reviewPendingSessionsQuery.data?.truncated === true;
  const wipListLimit = Math.min(
    wipSessionsQuery.data?.listLimit ?? 200,
    reviewPendingSessionsQuery.data?.listLimit ?? 200
  );
  const hasMore = scheduleQuery.data?.hasMore === true;

  const focusScanReceiver = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.setTimeout(() => scanFocusRef.current?.focus(), 0);
  }, []);

  const handleStartScan = useCallback(() => {
    setScanArmed(true);
    setScanStatus({
      kind: 'waiting',
      message: 'スキャン待ちです。移動票の製造order番号を読み取ってください。'
    });
    if (typeof document !== 'undefined') {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) {
        activeElement.blur();
      }
    }
    focusScanReceiver();
  }, [focusScanReceiver]);

  const handleCancelScan = useCallback(() => {
    setScanArmed(false);
    setScanStatus(null);
  }, []);

  const handleScan = useCallback((rawText: string) => {
    const normalized = normalizeManufacturingOrderScanText(rawText);
    setScanArmed(false);
    autoOpenedScanKeyRef.current = null;

    if (!normalized) {
      setScanStatus({
        kind: 'error',
        message: 'スキャン値が空です。移動票の製造order番号を読み取り直してください。'
      });
      return;
    }

    setProductNo(normalized);
    setDebouncedProductNo(normalized);
    setScannedProductNo(normalized);
    setScanStatus({
      kind: 'success',
      message: `読み取りました: ${normalized}`
    });
    setPage(1);
  }, []);

  useKeyboardWedgeScan({
    active: scanArmed,
    onScan: handleScan,
    minChars: 4
  });

  useEffect(() => {
    if (!hasScannedProductFilter || !trimmedResourceCd || scheduleQuery.isFetching) return;
    if (rows.length !== 1) return;

    const row = rows[0];
    const autoOpenKey = `${exactScannedProductNo}\0${trimmedResourceCd}\0${row.id}`;
    if (autoOpenedScanKeyRef.current === autoOpenKey) return;
    autoOpenedScanKeyRef.current = autoOpenKey;
    setInspectionWorkflowTarget(row);
  }, [exactScannedProductNo, hasScannedProductFilter, rows, scheduleQuery.isFetching, trimmedResourceCd]);

  const handleOpenInspectionDigitalInput = useCallback(
    (target: SelfInspectionWorkflowTarget) => {
      const path = target.selfInspectionEntryPath?.trim();
      if (!path) return;
      setInspectionWorkflowTarget(null);
      navigate(path);
    },
    [navigate]
  );

  const inspectionPaperPrintReturnTo = useMemo(
    () => `${location.pathname}${location.search}${location.hash}`,
    [location.hash, location.pathname, location.search]
  );

  const handleOpenInspectionPaperPrint = useCallback(
    async (target: SelfInspectionWorkflowTarget) => {
      const templateId = target.selfInspectionTemplateId?.trim();
      if (!templateId) return;
      setInspectionWorkflowTarget(null);
      try {
        const paper = await issueSelfInspectionPaperReport({
          templateId,
          productNo: target.productNo,
          scheduleRowId: target.scheduleRowId,
          fseiban: target.fseiban,
          fhincd: target.fhincd,
          fhinmei: target.fhinmei,
          resourceCd: target.resourceCd,
          machineName: target.machineName
        });
        navigate(
          kioskInspectionDrawingPaperReportPrintPath(paper.report.id, {
            returnTo: inspectionPaperPrintReturnTo
          })
        );
      } catch (error) {
        window.alert(getPaperReportIssueErrorMessage(error));
      }
    },
    [inspectionPaperPrintReturnTo, navigate]
  );

  const handleRecordApprovalNavigate = () => {
    navigate(KIOSK_SELF_INSPECTION_RECORD_APPROVALS_PATH);
  };

  const scanStatusClassName =
    scanStatus?.kind === 'error'
      ? 'border-rose-400/40 bg-rose-400/10 text-rose-100'
      : scanStatus?.kind === 'success'
        ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-100'
        : 'border-cyan-400/40 bg-cyan-400/10 text-cyan-100';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 bg-slate-800 p-3 text-white">
      <div className={clsx(kioskPanelClassName, 'p-3')}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className={kioskPageTitleClassName}>自主検査</h1>
            <p className="mt-1 text-sm text-white/70">
              仕掛中（全端末共通）を表示します。検索で新規開始の候補を絞り込めます。
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-end gap-2">
            <button
              type="button"
              className={scanArmed ? kioskButtonPrimaryClassName : kioskButtonSecondaryClassName}
              onClick={scanArmed ? handleCancelScan : handleStartScan}
            >
              {scanArmed ? 'スキャン中止' : '移動票スキャン'}
            </button>
            <button
              type="button"
              className={kioskButtonSecondaryClassName}
              onClick={handleRecordApprovalNavigate}
            >
              検査記録確認
            </button>
            <label className="grid min-w-[12rem] max-w-xs flex-1 gap-1 text-sm">
              <span className="text-white/70">製造order / 製番 / 品番</span>
              <input
                className={kioskInputClassName}
                value={productNo}
                onChange={(e) => {
                  setProductNo(e.target.value);
                  setScannedProductNo('');
                  setScanStatus(null);
                  autoOpenedScanKeyRef.current = null;
                  setPage(1);
                }}
                placeholder="製造order・製番・品番"
              />
            </label>
            <label className="grid w-[7rem] gap-1 text-sm">
              <span className="text-white/70">資源CD</span>
              <input
                className={kioskInputClassName}
                value={resourceCd}
                onChange={(e) => {
                  setResourceCd(e.target.value);
                  autoOpenedScanKeyRef.current = null;
                  setPage(1);
                }}
                placeholder="581"
              />
            </label>
            <Button
              type="button"
              variant="ghostOnDark"
              className="min-h-11"
              onClick={() => {
                setProductNo('');
                setResourceCd('');
                setScannedProductNo('');
                setScanArmed(false);
                setScanStatus(null);
                autoOpenedScanKeyRef.current = null;
                setPage(1);
              }}
            >
              クリア
            </Button>
          </div>
        </div>
        {scanStatus ? (
          <div
            ref={scanFocusRef}
            tabIndex={-1}
            role="status"
            aria-live="polite"
            className={clsx('mt-3 rounded border px-3 py-2 text-sm font-semibold outline-none', scanStatusClassName)}
          >
            {scanStatus.message}
          </div>
        ) : (
          <div ref={scanFocusRef} tabIndex={-1} className="sr-only" aria-hidden />
        )}
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
                : hasScannedProductFilter
                  ? `スキャンした製造order「${exactScannedProductNo}」の自主検査対象候補がありません。`
                  : '自主検査対象の候補がありません。'}
            </div>
          ) : (
            <>
              <p className="mb-2 text-xs text-white/55">検索結果（開始 / 再開候補）</p>
              <p className="mb-2 text-xs text-white/55">
                {page} ページ目（1 ページ {CANDIDATE_PAGE_SIZE} 件）
                {hasMore ? ' — さらに候補がある可能性があります' : ''}
              </p>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-4 xl:grid-cols-6">
                {rows.map((row) => (
                  <section key={row.id} className={clsx(kioskPanelClassName, 'grid min-w-0 gap-2 p-3')}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-base font-bold">{row.productNo}</p>
                        <p className="line-clamp-2 text-xs text-white/70">
                          {row.fhincd} / {row.fhinmei} / {row.resourceCd} / 指示数{' '}
                          {row.plannedQuantity ?? '—'}
                        </p>
                        <p className="truncate text-xs text-white/55">製番 {row.fseiban}</p>
                      </div>
                      {row.status ? (
                        <span className="rounded bg-cyan-500/20 px-2 py-1 text-xs font-semibold text-cyan-200">
                          {statusLabel(row.status)}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={clsx(
                          row.status === 'in_progress' || row.status === 'completed'
                            ? kioskButtonPrimaryClassName
                            : buttonClassName('ghostOnDark'),
                          'inline-flex w-full min-h-11 items-center justify-center text-base'
                        )}
                        onClick={() => setInspectionWorkflowTarget(row)}
                      >
                        検査方法を選択
                      </button>
                    </div>
                  </section>
                ))}
              </div>
              {hasMore || page > 1 ? (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <Button
                    type="button"
                    variant="ghostOnDark"
                    className="min-h-11"
                    disabled={page <= 1 || scheduleQuery.isFetching}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    前のページ
                  </Button>
                  <Button
                    type="button"
                    variant="ghostOnDark"
                    className="min-h-11"
                    disabled={!hasMore || scheduleQuery.isFetching}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    次のページ
                  </Button>
                </div>
              ) : null}
            </>
          )
        ) : (wipSessionsQuery.isLoading || reviewPendingSessionsQuery.isLoading) && wipSessions.length === 0 ? (
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
            <div className="grid grid-cols-1 gap-2 md:grid-cols-4 xl:grid-cols-6">
              {wipSessions.map((session) => (
                <SessionWipCard key={session.id} session={session} />
              ))}
            </div>
          </>
        )}
      </div>
      <SelfInspectionWorkflowModal
        target={inspectionWorkflowTarget}
        onClose={() => setInspectionWorkflowTarget(null)}
        onOpenDigitalInput={handleOpenInspectionDigitalInput}
        onOpenPaperPrint={(target) => void handleOpenInspectionPaperPrint(target)}
      />
    </div>
  );
}
