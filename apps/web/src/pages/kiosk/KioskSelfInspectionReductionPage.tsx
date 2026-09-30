import {
  DEFAULT_SELF_INSPECTION_REDUCTION_POLICY,
  SELF_INSPECTION_REDUCTION_CPK_THRESHOLDS,
  type SelfInspectionReductionCpkThreshold,
  type SelfInspectionReductionPolicy
} from '@raspi-system/shared-types';
import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';


import {
  useAddSelfInspectionReductionApprover,
  useRecordSelfInspectionChangePoint,
  useRecordSelfInspectionLevelDecision,
  useRemoveSelfInspectionReductionApprover,
  useSelfInspectionReductionInsights,
  useSelfInspectionReductionSettings,
  useUpdateSelfInspectionReductionPolicy
} from '../../api/hooks';
import { readApiErrorMessage } from '../../features/part-measurement/selfInspectionRecordApproval/selfInspectionRecordApprovalViewModel';
import { ReductionChangePointDialog } from '../../features/part-measurement/selfInspectionReduction/ReductionChangePointDialog';
import { ReductionStairs } from '../../features/part-measurement/selfInspectionReduction/reductionCharts';
import { ReductionDetail } from '../../features/part-measurement/selfInspectionReduction/ReductionDetail';
import { ReductionList } from '../../features/part-measurement/selfInspectionReduction/ReductionList';
import { ReductionSettingsDialog } from '../../features/part-measurement/selfInspectionReduction/ReductionSettingsDialog';
import { Segmented, kioskButtonClass, kioskInputClass } from '../../features/part-measurement/selfInspectionReduction/reductionUi';
import {
  buildReductionRows,
  countReductionVerdicts,
  estimateMonthlySavings,
  filterReductionRows,
  type ReductionProcessFilter,
  type ReductionVerdictFilter
} from '../../features/part-measurement/selfInspectionReduction/selfInspectionReductionViewModel';
import {
  KIOSK_SELF_INSPECTION_RECORD_APPROVALS_PATH,
  KIOSK_SELF_INSPECTION_REDUCTION_PATH
} from '../../features/part-measurement/selfInspectionRoutes';
import { useNfcStream } from '../../hooks/useNfcStream';

import type { SelfInspectionChangePointKind, SelfInspectionReductionPeriodDays } from '../../api/client';

type NfcPurpose = 'approve' | 'changePoint' | 'addApprover';

const PERIOD_OPTIONS: ReadonlyArray<{ value: SelfInspectionReductionPeriodDays; label: string }> = [
  { value: 30, label: '30日' },
  { value: 90, label: '90日' },
  { value: 180, label: '180日' }
];
const PROCESS_OPTIONS: ReadonlyArray<{ value: ReductionProcessFilter; label: string }> = [
  { value: 'all', label: 'すべて' },
  { value: 'cutting', label: '切削' },
  { value: 'grinding', label: '研削' }
];

/**
 * 減らせる検査。自主検査の記録から、品番×工程×資源ごとに検査を1段軽くできるかを示す。
 * 承認は記録だけで、実際の検査モード変更は管理画面のテンプレート改版で行う。
 */
export function KioskSelfInspectionReductionPage() {
  const location = useLocation();
  const [periodDays, setPeriodDays] = useState<SelfInspectionReductionPeriodDays>(90);
  const [process, setProcess] = useState<ReductionProcessFilter>('all');
  const [query, setQuery] = useState('');
  const [verdictFilter, setVerdictFilter] = useState<ReductionVerdictFilter>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewCpk, setViewCpk] = useState<SelfInspectionReductionCpkThreshold | null>(null);

  const insightsQuery = useSelfInspectionReductionInsights(periodDays);
  const settingsQuery = useSelfInspectionReductionSettings();
  const savedPolicy = settingsQuery.data?.policy ?? DEFAULT_SELF_INSPECTION_REDUCTION_POLICY;
  const policy: SelfInspectionReductionPolicy = useMemo(
    () => ({
      cpkThreshold: viewCpk ?? savedPolicy.cpkThreshold,
      requiredConsecutiveLots: savedPolicy.requiredConsecutiveLots,
      minimumSampleCount: savedPolicy.minimumSampleCount,
      resetStreakOnChangePoint: savedPolicy.resetStreakOnChangePoint
    }),
    [savedPolicy, viewCpk]
  );

  const allRows = useMemo(() => buildReductionRows(insightsQuery.data?.parts ?? [], policy), [insightsQuery.data, policy]);
  const scopedRows = useMemo(
    () => filterReductionRows(allRows, { verdict: null, process, query }),
    [allRows, process, query]
  );
  const rows = useMemo(
    () => filterReductionRows(scopedRows, { verdict: verdictFilter, process: 'all', query: '' }),
    [scopedRows, verdictFilter]
  );
  const counts = useMemo(() => countReductionVerdicts(scopedRows), [scopedRows]);
  const savings = useMemo(
    () => estimateMonthlySavings(scopedRows, insightsQuery.data?.secondsPerPiece ?? null),
    [scopedRows, insightsQuery.data?.secondsPerPiece]
  );

  useEffect(() => {
    if (rows.length === 0) return;
    if (!selectedId || !rows.some((row) => row.id === selectedId)) setSelectedId(rows[0]!.id);
  }, [rows, selectedId]);
  const selectedRow = allRows.find((row) => row.id === selectedId) ?? null;

  // ---------- NFC (承認・変化点・承認者追加で共用) ----------
  const [nfcPurpose, setNfcPurpose] = useState<NfcPurpose | null>(null);
  const [nfcBusy, setNfcBusy] = useState(false);
  const lastNfcKeyRef = useRef<string | null>(null);
  const settingsPasswordRef = useRef<string>('');
  const [approvalMessage, setApprovalMessage] = useState<string | null>(null);
  const [changePointOpen, setChangePointOpen] = useState(false);
  const [changePointKind, setChangePointKind] = useState<SelfInspectionChangePointKind | null>(null);
  const [changePointMessage, setChangePointMessage] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);

  const decisionMutation = useRecordSelfInspectionLevelDecision();
  const changePointMutation = useRecordSelfInspectionChangePoint();
  const updatePolicyMutation = useUpdateSelfInspectionReductionPolicy();
  const addApproverMutation = useAddSelfInspectionReductionApprover();
  const removeApproverMutation = useRemoveSelfInspectionReductionApprover();

  const disarm = useCallback(() => {
    setNfcPurpose(null);
    lastNfcKeyRef.current = null;
  }, []);

  const isActiveRoute = location.pathname.startsWith(KIOSK_SELF_INSPECTION_REDUCTION_PATH);
  const nfcEvent = useNfcStream(isActiveRoute && nfcPurpose != null && !nfcBusy);

  useEffect(() => {
    if (!nfcPurpose || nfcBusy || !nfcEvent?.uid) return;
    const key = `${nfcEvent.uid}:${nfcEvent.timestamp ?? ''}`;
    if (lastNfcKeyRef.current === key) return;
    lastNfcKeyRef.current = key;
    const uid = nfcEvent.uid;
    const purpose = nfcPurpose;
    setNfcBusy(true);

    let task: Promise<unknown>;
    if (purpose === 'approve' && selectedRow?.judgement.target) {
      const { part, judgement } = selectedRow;
      task = decisionMutation
        .mutateAsync({
          ...part.key,
          direction: judgement.verdict === 'restore' ? 'restore' : 'reduce',
          periodDays,
          cpkThreshold: policy.cpkThreshold,
          approverEmployeeTagUid: uid
        })
        .then((decision) => {
          setApprovalMessage(`承認を記録しました：${decision.fromLabel} → ${decision.toLabel}（${decision.approverName}）`);
          disarm();
        })
        .catch((error: unknown) => setApprovalMessage(readApiErrorMessage(error, '承認を記録できませんでした')));
    } else if (purpose === 'changePoint' && selectedRow && changePointKind) {
      task = changePointMutation
        .mutateAsync({ ...selectedRow.part.key, kind: changePointKind, employeeTagUid: uid })
        .then(() => {
          setChangePointMessage(null);
          setChangePointKind(null);
          setChangePointOpen(false);
          disarm();
        })
        .catch((error: unknown) => setChangePointMessage(readApiErrorMessage(error, '変化点を記録できませんでした')));
    } else if (purpose === 'addApprover') {
      task = addApproverMutation
        .mutateAsync({ employeeTagUid: uid, accessPassword: settingsPasswordRef.current })
        .then(() => {
          setSettingsMessage(null);
          disarm();
        })
        .catch((error: unknown) => setSettingsMessage(readApiErrorMessage(error, '承認できる人を追加できませんでした')));
    } else {
      task = Promise.resolve();
      disarm();
    }
    void task.finally(() => setNfcBusy(false));
  }, [
    addApproverMutation,
    changePointKind,
    changePointMutation,
    decisionMutation,
    disarm,
    nfcBusy,
    nfcEvent,
    nfcPurpose,
    periodDays,
    policy.cpkThreshold,
    selectedRow
  ]);

  const selectRow = useCallback(
    (id: string) => {
      setSelectedId(id);
      setApprovalMessage(null);
      if (nfcPurpose === 'approve') disarm();
    },
    [disarm, nfcPurpose]
  );

  const closeChangePoint = useCallback(() => {
    setChangePointOpen(false);
    setChangePointKind(null);
    setChangePointMessage(null);
    if (nfcPurpose === 'changePoint') disarm();
  }, [disarm, nfcPurpose]);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    setSettingsMessage(null);
    settingsPasswordRef.current = '';
    if (nfcPurpose === 'addApprover') disarm();
  }, [disarm, nfcPurpose]);

  const settingsPending =
    updatePolicyMutation.isPending || addApproverMutation.isPending || removeApproverMutation.isPending;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5 bg-[#0e1621] p-4 text-[#e8eef6]">
      <div className="flex h-[52px] shrink-0 items-center gap-3">
        <Link to={KIOSK_SELF_INSPECTION_RECORD_APPROVALS_PATH} className={kioskButtonClass}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          記録確認
        </Link>
        <h1 className="mx-1 whitespace-nowrap text-[28px] font-black tracking-[0.04em]">減らせる検査</h1>
        <Segmented label="期間" value={periodDays} options={PERIOD_OPTIONS} onChange={setPeriodDays} />
        <Segmented label="工程" value={process} options={PROCESS_OPTIONS} onChange={setProcess} />
        <Segmented
          label="工程能力の基準"
          prefix="基準 Cpk"
          value={policy.cpkThreshold}
          options={SELF_INSPECTION_REDUCTION_CPK_THRESHOLDS.map((value) => ({ value, label: value.toFixed(2) }))}
          onChange={setViewCpk}
        />
        <span className="flex-1" />
        <input
          aria-label="品番・資源CDで探す"
          placeholder="品番・資源CD"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={clsx(kioskInputClass, 'w-56')}
        />
        <button type="button" className={kioskButtonClass} onClick={() => setSettingsOpen(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
            <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
            <circle cx="16" cy="7" r="2.2" />
            <circle cx="10" cy="17" r="2.2" />
          </svg>
          判定設定
        </button>
      </div>

      {insightsQuery.isError ? (
        <p role="alert" className="rounded-lg border border-rose-400/40 bg-rose-500/15 px-4 py-2 text-rose-100">
          {readApiErrorMessage(insightsQuery.error, '記録を読み込めませんでした')}
        </p>
      ) : null}

      <div className="grid h-[184px] shrink-0 grid-cols-[minmax(0,1fr)_minmax(420px,520px)] gap-3">
        <div className="relative overflow-hidden rounded-xl border border-[#243347] bg-[#141e2b]">
          <ReductionStairs rows={scopedRows} selectedId={selectedId} onSelect={selectRow} />
          <div className="absolute right-[18px] top-3.5 flex items-center gap-4 text-[15px] font-bold text-[#aab8ca]">
            検査の階段
            <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#72849b]">
              <i className="block h-2.5 w-2.5 rounded-full bg-emerald-400" />
              1段下へ
            </span>
            <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#72849b]">
              <i className="block h-2.5 w-2.5 rounded-full bg-rose-400" />
              1段上へ
            </span>
          </div>
        </div>
        <div className="grid grid-cols-[auto_1fr] grid-rows-[auto_1fr_auto] gap-x-9 gap-y-1.5 rounded-xl border border-[#23503f] bg-gradient-to-br from-[#0f2a26] to-[#12202f] px-6 py-[18px]">
          <span className="col-span-2 text-[15px] font-bold text-[#9fe3c6]">「減らせる」{counts.reduce}品番を1段下げると</span>
          <span className="self-center font-mono text-[52px] font-semibold leading-none text-emerald-400">
            {savings.hours == null ? '—' : `−${savings.hours.toFixed(1)}`}
            <small className="ml-1.5 font-sans text-[17px] font-medium text-[#bfeedd]">時間 / 月</small>
          </span>
          <span className="grid content-center gap-1">
            <span className="text-[15px] font-bold text-[#8fc9b3]">測る個数</span>
            <span className="font-mono text-[28px] text-[#d6f5ea]">
              −{savings.pieces.toLocaleString()}
              <small className="ml-1 font-sans text-sm text-[#8fc9b3]">個 / 月</small>
            </span>
          </span>
          <span className="col-span-2 text-[13px] text-[#7fae9d]">
            1個 {insightsQuery.data?.secondsPerPiece != null ? Math.round(insightsQuery.data.secondsPerPiece) : '—'}秒（入力記録の中央値）で計算した目安
          </span>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-3.5">
        <ReductionList
          rows={rows}
          counts={counts}
          totalCount={scopedRows.length}
          verdictFilter={verdictFilter}
          onVerdictFilterChange={setVerdictFilter}
          selectedId={selectedId}
          onSelect={selectRow}
          minimumSampleCount={policy.minimumSampleCount}
          loading={insightsQuery.isLoading}
        />
        <ReductionDetail
          row={selectedRow}
          policy={policy}
          onOpenChangePoint={() => {
            setChangePointMessage(null);
            setChangePointOpen(true);
            if (nfcPurpose === 'approve') disarm();
          }}
          approval={{
            armed: nfcPurpose === 'approve',
            pending: decisionMutation.isPending,
            message: approvalMessage,
            onStart: () => {
              setApprovalMessage(null);
              lastNfcKeyRef.current = null;
              setNfcPurpose('approve');
            },
            onCancel: disarm
          }}
        />
      </div>

      <ReductionChangePointDialog
        part={changePointOpen ? (selectedRow?.part ?? null) : null}
        selectedKind={changePointKind}
        pending={changePointMutation.isPending}
        message={changePointMessage}
        onSelectKind={(kind) => {
          setChangePointKind(kind);
          setChangePointMessage(null);
          lastNfcKeyRef.current = null;
          if (kind) setNfcPurpose('changePoint');
          else disarm();
        }}
        onClose={closeChangePoint}
      />

      <ReductionSettingsDialog
        open={settingsOpen}
        policy={savedPolicy}
        approvers={settingsQuery.data?.approvers ?? []}
        pending={settingsPending}
        message={settingsMessage}
        addArmed={nfcPurpose === 'addApprover'}
        onClose={closeSettings}
        onSave={(next, password) => {
          setSettingsMessage(null);
          updatePolicyMutation
            .mutateAsync({ ...next, accessPassword: password })
            .then(() => {
              setViewCpk(null);
              closeSettings();
            })
            .catch((error: unknown) => setSettingsMessage(readApiErrorMessage(error, '設定を保存できませんでした')));
        }}
        onArmAddApprover={(password) => {
          settingsPasswordRef.current = password;
          setSettingsMessage(null);
          lastNfcKeyRef.current = null;
          setNfcPurpose('addApprover');
        }}
        onCancelAddApprover={disarm}
        onRemoveApprover={(id, password) => {
          setSettingsMessage(null);
          removeApproverMutation
            .mutateAsync({ id, accessPassword: password })
            .catch((error: unknown) => setSettingsMessage(readApiErrorMessage(error, '承認できる人を外せませんでした')));
        }}
      />

    </div>
  );
}
