import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  issueSelfInspectionPaperReport,
  resolveSelfInspectionNfcTagUid
} from '../../api/client';
import { useKioskProductionSchedule, useSelfInspectionSessions } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { useKeyboardWedgeScan } from '../../features/barcode-scan';
import {
  kioskButtonPrimaryClassName,
  kioskButtonSecondaryClassName,
  kioskPageTitleClassName,
  kioskPanelClassName
} from '../../features/kiosk/kioskTheme';
import { kioskInspectionDrawingPaperReportPrintPath } from '../../features/part-measurement/inspection-drawing/kioskInspectionDrawingRoutes';
import { normalizeManufacturingOrderScanText } from '../../features/part-measurement/manufacturingOrderScan';
import { SelfInspectionFilterCombobox } from '../../features/part-measurement/SelfInspectionFilterCombobox';
import { KIOSK_SELF_INSPECTION_RECORD_APPROVALS_PATH } from '../../features/part-measurement/selfInspectionRoutes';
import { SelfInspectionTable } from '../../features/part-measurement/SelfInspectionTable';
import {
  buildProductFilterOptions,
  buildResourceFilterOptions,
  presentSelfInspectionCandidateRow,
  presentSelfInspectionSessionRow
} from '../../features/part-measurement/selfInspectionTableModel';
import {
  SelfInspectionWorkflowModal,
  type SelfInspectionWorkflowTarget
} from '../../features/part-measurement/SelfInspectionWorkflowModal';
import { useNfcStream } from '../../hooks/useNfcStream';

import type { ProductionScheduleRow } from '../../api/client';
import type { SelfInspectionStatus } from '../../features/part-measurement/types';

const CANDIDATE_PAGE_SIZE = 50;
const CANDIDATE_SEARCH_DEBOUNCE_MS = 400;
const WIP_REFETCH_INTERVAL_MS = 60_000;
/** 製番・品番テキストのみのときは API 走査を避けるための最小文字数（資源CD 併用時は不要） */
const CANDIDATE_MIN_TEXT_SEARCH_LENGTH = 2;

type ScanStatus = {
  kind: 'waiting' | 'success' | 'error';
  message: string;
};

type EmployeeFilter = {
  employeeId: string;
  displayName: string;
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

function nfcResolveErrorMessage(kind: 'duplicate' | 'instrument' | 'instrument_unavailable' | 'unknown'): string {
  if (kind === 'instrument') return '氏名タグではありません。計測機器タグが読み取られました。';
  if (kind === 'instrument_unavailable') return '氏名タグではありません。使用不可の計測機器タグです。';
  if (kind === 'duplicate') return '同じUIDの登録が複数あるため氏名を特定できません。';
  return '未登録の氏名タグです。';
}

export function KioskSelfInspectionPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [productNo, setProductNo] = useState('');
  const [resourceCd, setResourceCd] = useState('');
  const [debouncedProductNo, setDebouncedProductNo] = useState('');
  const [debouncedResourceCd, setDebouncedResourceCd] = useState('');
  const [scannedProductNo, setScannedProductNo] = useState('');
  const [movementScanArmed, setMovementScanArmed] = useState(false);
  const [nameScanArmed, setNameScanArmed] = useState(false);
  const [employeeFilter, setEmployeeFilter] = useState<EmployeeFilter | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [inspectionWorkflowTarget, setInspectionWorkflowTarget] = useState<SelfInspectionCandidateRow | null>(null);
  const [page, setPage] = useState(1);
  const scanFocusRef = useRef<HTMLDivElement | null>(null);
  const autoOpenedScanKeyRef = useRef<string | null>(null);
  const lastNameNfcEventKeyRef = useRef<string | null>(null);
  const nfcEvent = useNfcStream(nameScanArmed);

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

  const wipListLimit = Math.min(
    wipSessionsQuery.data?.listLimit ?? 200,
    reviewPendingSessionsQuery.data?.listLimit ?? 200
  );
  const mergedWipSessions = useMemo(
    () =>
      [...(reviewPendingSessionsQuery.data?.sessions ?? []), ...(wipSessionsQuery.data?.sessions ?? [])]
        .filter((session, index, sessions) => sessions.findIndex((row) => row.id === session.id) === index)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [reviewPendingSessionsQuery.data?.sessions, wipSessionsQuery.data?.sessions]
  );
  const wipSessions = useMemo(
    () => mergedWipSessions.slice(0, wipListLimit),
    [mergedWipSessions, wipListLimit]
  );
  const filteredWipSessions = useMemo(
    () =>
      employeeFilter
        ? wipSessions.filter((session) =>
            (session.participantEmployees ?? []).some(
              (participant) => participant.employeeId === employeeFilter.employeeId
            )
          )
        : wipSessions,
    [employeeFilter, wipSessions]
  );
  const displayedFilterSources = hasSearchInput ? rows : filteredWipSessions;
  const productOptions = useMemo(
    () => buildProductFilterOptions(displayedFilterSources),
    [displayedFilterSources]
  );
  const resourceOptions = useMemo(
    () => buildResourceFilterOptions(displayedFilterSources),
    [displayedFilterSources]
  );
  const candidateTableRows = useMemo(() => rows.map(presentSelfInspectionCandidateRow), [rows]);
  const wipTableRows = useMemo(
    () => filteredWipSessions.map(presentSelfInspectionSessionRow),
    [filteredWipSessions]
  );
  const wipListTruncated =
    wipSessionsQuery.data?.truncated === true ||
    reviewPendingSessionsQuery.data?.truncated === true ||
    mergedWipSessions.length > wipListLimit;
  const hasMore = scheduleQuery.data?.hasMore === true;

  const clearEmployeeFilter = useCallback(() => {
    setEmployeeFilter(null);
    setNameScanArmed(false);
    lastNameNfcEventKeyRef.current = null;
  }, []);

  const handleProductFilterChange = useCallback(
    (value: string) => {
      clearEmployeeFilter();
      setProductNo(value);
      setScannedProductNo('');
      setMovementScanArmed(false);
      setScanStatus(null);
      autoOpenedScanKeyRef.current = null;
      setPage(1);
    },
    [clearEmployeeFilter]
  );

  const handleResourceFilterChange = useCallback(
    (value: string) => {
      clearEmployeeFilter();
      setResourceCd(value);
      setMovementScanArmed(false);
      setScanStatus(null);
      autoOpenedScanKeyRef.current = null;
      setPage(1);
    },
    [clearEmployeeFilter]
  );

  const focusScanReceiver = useCallback(() => {
    window.setTimeout(() => scanFocusRef.current?.focus(), 0);
  }, []);

  const handleStartMovementScan = useCallback(() => {
    clearEmployeeFilter();
    setMovementScanArmed(true);
    setScanStatus({
      kind: 'waiting',
      message: '移動票の製造order番号を読み取ってください。'
    });
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) activeElement.blur();
    focusScanReceiver();
  }, [clearEmployeeFilter, focusScanReceiver]);

  const handleMovementScan = useCallback((rawText: string) => {
    const normalized = normalizeManufacturingOrderScanText(rawText);
    setMovementScanArmed(false);
    autoOpenedScanKeyRef.current = null;

    if (!normalized) {
      setScanStatus({ kind: 'error', message: 'スキャン値が空です。移動票を読み取り直してください。' });
      return;
    }
    setProductNo(normalized);
    setDebouncedProductNo(normalized);
    setScannedProductNo(normalized);
    setScanStatus({ kind: 'success', message: `移動票: ${normalized}` });
    setPage(1);
  }, []);

  useKeyboardWedgeScan({
    active: movementScanArmed,
    onScan: handleMovementScan,
    minChars: 4
  });

  const handleStartNameScan = useCallback(() => {
    setMovementScanArmed(false);
    setProductNo('');
    setResourceCd('');
    setDebouncedProductNo('');
    setDebouncedResourceCd('');
    setScannedProductNo('');
    setEmployeeFilter(null);
    autoOpenedScanKeyRef.current = null;
    lastNameNfcEventKeyRef.current = null;
    setPage(1);
    setNameScanArmed(true);
    setScanStatus({ kind: 'waiting', message: '氏名NFCタグを読み取ってください。' });
  }, []);

  useEffect(() => {
    if (!nameScanArmed || !nfcEvent?.uid) return;
    const eventKey = nfcEvent.eventKey ?? `${nfcEvent.eventId ?? ''}:${nfcEvent.uid}:${nfcEvent.timestamp}`;
    if (lastNameNfcEventKeyRef.current === eventKey) return;
    lastNameNfcEventKeyRef.current = eventKey;
    setNameScanArmed(false);

    void resolveSelfInspectionNfcTagUid(nfcEvent.uid)
      .then((result) => {
        if (result.kind === 'employee') {
          setEmployeeFilter({ employeeId: result.employee.id, displayName: result.employee.displayName });
          setScanStatus({ kind: 'success', message: `氏名: ${result.employee.displayName}` });
          return;
        }
        setScanStatus({ kind: 'error', message: nfcResolveErrorMessage(result.kind) });
      })
      .catch(() => {
        setScanStatus({ kind: 'error', message: '氏名タグの照合に失敗しました。' });
      });
  }, [nameScanArmed, nfcEvent]);

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

  const handleClear = useCallback(() => {
    setProductNo('');
    setResourceCd('');
    setDebouncedProductNo('');
    setDebouncedResourceCd('');
    setScannedProductNo('');
    setMovementScanArmed(false);
    setNameScanArmed(false);
    setEmployeeFilter(null);
    setScanStatus(null);
    autoOpenedScanKeyRef.current = null;
    lastNameNfcEventKeyRef.current = null;
    setPage(1);
  }, []);

  const scanStatusClassName =
    scanStatus?.kind === 'error'
      ? 'border-rose-400/40 bg-rose-400/10 text-rose-100'
      : scanStatus?.kind === 'success'
        ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-100'
        : scanStatus
          ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-100'
          : 'border-transparent text-white/40';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 bg-slate-800 p-2 text-white">
      <div className={clsx(kioskPanelClassName, 'flex h-[60px] shrink-0 flex-nowrap items-center gap-2 px-2')}>
        <h1 className={clsx(kioskPageTitleClassName, 'shrink-0 whitespace-nowrap')}>自主検査</h1>
        <button
          type="button"
          className={movementScanArmed ? kioskButtonPrimaryClassName : kioskButtonSecondaryClassName}
          onClick={() => {
            if (movementScanArmed) {
              setMovementScanArmed(false);
              setScanStatus(null);
            } else {
              handleStartMovementScan();
            }
          }}
        >
          {movementScanArmed ? 'スキャン中止' : '移動票スキャン'}
        </button>
        <button
          type="button"
          className={nameScanArmed ? kioskButtonPrimaryClassName : kioskButtonSecondaryClassName}
          onClick={() => {
            if (nameScanArmed) {
              setNameScanArmed(false);
              setScanStatus(null);
            } else {
              handleStartNameScan();
            }
          }}
        >
          {nameScanArmed ? 'スキャン中止' : '氏名スキャン'}
        </button>
        <button
          type="button"
          className={kioskButtonSecondaryClassName}
          onClick={() => navigate(KIOSK_SELF_INSPECTION_RECORD_APPROVALS_PATH)}
        >
          記録承認
        </button>
        <SelfInspectionFilterCombobox
          ariaLabel="製造order / 製番 / 品番"
          value={productNo}
          placeholder="製造order・製番・品番"
          options={productOptions}
          className="w-[15rem]"
          dropdownClassName="w-[28rem]"
          onChange={handleProductFilterChange}
          onSelect={handleProductFilterChange}
        />
        <SelfInspectionFilterCombobox
          ariaLabel="資源CD"
          value={resourceCd}
          placeholder="581"
          options={resourceOptions}
          className="w-[7.5rem]"
          dropdownClassName="w-[10rem]"
          onChange={handleResourceFilterChange}
          onSelect={handleResourceFilterChange}
        />
        <Button type="button" variant="ghostOnDark" className="min-h-11 shrink-0 px-3" onClick={handleClear}>
          クリア
        </Button>
        <div
          ref={scanFocusRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          title={scanStatus?.message}
          className={clsx(
            'min-w-[7rem] flex-1 truncate rounded border px-2 py-1 text-xs font-semibold outline-none',
            scanStatusClassName
          )}
        >
          {scanStatus?.message ?? ''}
        </div>
      </div>

      <main className="min-h-0 flex-1 overflow-auto rounded border border-white/15 bg-slate-950/45 p-2">
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
              <div className="mb-2 flex items-center justify-between gap-3 text-xs text-white/55">
                <span>検索結果（開始 / 再開候補）</span>
                <span>
                  {page} ページ目（1ページ {CANDIDATE_PAGE_SIZE}件）
                  {hasMore ? ' — 続きあり' : ''}
                </span>
              </div>
              <SelfInspectionTable
                rows={candidateTableRows}
                onCandidateSelect={(id) => {
                  const target = rows.find((row) => row.id === id);
                  if (target) setInspectionWorkflowTarget(target);
                }}
              />
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
        ) : filteredWipSessions.length === 0 ? (
          <div className="py-12 text-center text-white/60">
            {employeeFilter
              ? `氏名「${employeeFilter.displayName}」の仕掛中自主検査はありません。`
              : '仕掛中の自主検査はありません。検索して新規開始できます。'}
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between gap-3 text-xs text-white/55">
              <span>仕掛中（更新の新しい順・全端末共通）</span>
              {employeeFilter ? <span>氏名: {employeeFilter.displayName}</span> : null}
            </div>
            {wipListTruncated ? (
              <p className="mb-2 rounded border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                仕掛中は最新 {wipListLimit} 件まで表示しています。それより古いセッションは検索対象外です。
              </p>
            ) : null}
            <SelfInspectionTable rows={wipTableRows} onCandidateSelect={() => undefined} />
          </>
        )}
      </main>
      <SelfInspectionWorkflowModal
        target={inspectionWorkflowTarget}
        onClose={() => setInspectionWorkflowTarget(null)}
        onOpenDigitalInput={handleOpenInspectionDigitalInput}
        onOpenPaperPrint={(target) => void handleOpenInspectionPaperPrint(target)}
      />
    </div>
  );
}
