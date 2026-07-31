import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import {
  useApproveSelfInspectionRecordApproval,
  useVerifyKioskSelfInspectionRecordApprovalAccessPassword,
  useResolveSelfInspectionRecordApprovalApprover,
  useSelfInspectionRegistrationPolicy,
  useSelfInspectionInvalidation,
  useSelfInspectionInvalidations,
  useSelfInspectionRecordApprovalSession,
  useSelfInspectionRecordApprovals,
  useUpdateSelfInspectionRegistrationPolicy
} from '../../api/hooks';
import { buttonClassName, Button } from '../../components/ui/Button';
import {
  kioskSelfInspectionInspectorSessionPath,
  kioskSelfInspectionSessionPath
} from '../../features/part-measurement/selfInspectionRoutes';
import { useNfcStream } from '../../hooks/useNfcStream';

import type {
  SelfInspectionRecordApprovalSessionDetailDto,
  SelfInspectionRecordApprovalSessionListItemDto,
  SelfInspectionRecordApprovalState,
  SelfInspectionItemInvalidationDetailDto,
  SelfInspectionItemInvalidationDto,
  SelfInspectionItemInvalidationState
} from '../../features/part-measurement/types';

type RecordApprovalFilterState = 'active' | 'invalidated' | SelfInspectionRecordApprovalState;

const EMPTY_SESSIONS: SelfInspectionRecordApprovalSessionListItemDto[] = [];
const EMPTY_INVALIDATIONS: SelfInspectionItemInvalidationDto[] = [];

const STATE_OPTIONS: Array<{ value: RecordApprovalFilterState; label: string }> = [
  { value: 'active', label: '未完了' },
  { value: 'input_incomplete', label: '入力途中' },
  { value: 'inspector_measurement_pending', label: '検査員待ち' },
  { value: 'registration_incomplete', label: '点検不足' },
  { value: 'final_judgement_pending', label: '最終判定待ち' },
  { value: 'finalization_ready', label: '最終確定可能' },
  { value: 'approvable', label: '承認可能' },
  { value: 'approved', label: '承認済み' },
  { value: 'completed', label: '完了済み' },
  { value: 'invalidated', label: '削除済み' }
];

const INVALIDATION_STATE_LABELS: Record<SelfInspectionItemInvalidationState, string> = {
  NOT_STARTED: '未開始',
  IN_PROGRESS: '入力中',
  REVIEW_PENDING: '承認待ち',
  COMPLETED: '完了',
  APPROVED: '承認済み'
};

function stateLabel(state: SelfInspectionRecordApprovalState): string {
  switch (state) {
    case 'approved':
      return '承認済み';
    case 'approvable':
      return '承認可能';
    case 'finalization_ready':
      return '最終確定可能';
    case 'final_judgement_pending':
      return '最終判定待ち';
    case 'registration_incomplete':
      return '点検不足';
    case 'inspector_measurement_pending':
      return '検査員待ち';
    case 'completed':
      return '完了済み';
    case 'input_incomplete':
    default:
      return '入力途中';
  }
}

function stateClassName(state: SelfInspectionRecordApprovalState): string {
  switch (state) {
    case 'approved':
      return 'bg-emerald-400/20 text-emerald-100';
    case 'approvable':
      return 'bg-sky-400/25 text-sky-100';
    case 'finalization_ready':
      return 'bg-cyan-400/25 text-cyan-100';
    case 'final_judgement_pending':
      return 'bg-red-400/20 text-red-100';
    case 'registration_incomplete':
      return 'bg-amber-400/25 text-amber-100';
    case 'inspector_measurement_pending':
      return 'bg-red-400/20 text-red-100';
    case 'completed':
      return 'bg-emerald-400/20 text-emerald-100';
    case 'input_incomplete':
    default:
      return 'bg-slate-500/35 text-white/80';
  }
}

function formatDateTime(raw: string | null): string {
  if (!raw) return '-';
  return new Date(raw).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

function formatParticipantNames(names: string[] | null | undefined): string {
  if (!names || names.length === 0) return '未登録';
  return names.join('、');
}

function formatInstrumentUsageLabel(usage: {
  measuringInstrumentManagementNumberSnapshot: string;
  measuringInstrumentNameSnapshot: string;
}): string {
  return `${usage.measuringInstrumentManagementNumberSnapshot} ${usage.measuringInstrumentNameSnapshot}`;
}

function inspectorJudgementLabel(status: string | null): string {
  if (status === 'NOT_EVALUATED') return '未判定';
  return status ?? '-';
}

function readApiErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const message = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }
  return fallback;
}

function SessionListItem({
  session,
  selected,
  onSelect
}: {
  session: SelfInspectionRecordApprovalSessionListItemDto;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={clsx(
        'grid w-full gap-1 rounded border p-3 text-left transition-colors',
        selected
          ? 'border-sky-300 bg-sky-500/15'
          : 'border-white/15 bg-slate-900/80 hover:border-white/35 hover:bg-slate-800'
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-bold">{session.productNo}</p>
          <p className="line-clamp-2 text-xs text-white/65">
            {session.fhincd} / {session.fhinmei} / 資源 {session.resourceCd}
          </p>
          {session.fseiban ? <p className="text-xs text-white/50">製番 {session.fseiban}</p> : null}
        </div>
        <span className={clsx('shrink-0 rounded px-2 py-1 text-xs font-semibold', stateClassName(session.recordApprovalState))}>
          {stateLabel(session.recordApprovalState)}
        </span>
      </div>
      <p className="text-xs text-white/55">
        入力 {session.completedRequiredEntryCount}/{session.requiredEntryCount}件
        {session.inspectorMissingRequiredEntryCount > 0 || session.inspectorIncompleteValueEntryCount > 0
          ? ` / 検査員 ${session.inspectorCompletedRequiredEntryCount}/${session.requiredEntryCount}件`
          : session.inspectorCompletedRequiredEntryCount > 0
            ? ` / 検査員 ${session.inspectorCompletedRequiredEntryCount}/${session.requiredEntryCount}件`
            : ''}
        {session.incompleteRegistrationEntryCount > 0 ? ` / 点検不足 ${session.incompleteRegistrationEntryCount}件` : ''}
        {session.inspectorIncompleteRegistrationEntryCount > 0 ? ` / 検査員点検不足 ${session.inspectorIncompleteRegistrationEntryCount}件` : ''}
        {session.pendingReviewCount > 0
          ? ` / ${
              session.decisionWorkflow === 'INSPECTOR_FINAL_JUDGEMENT'
                ? '最終判定待ち'
                : '公差外'
            } ${session.pendingReviewCount}点`
          : ''}
      </p>
      <p className="text-xs text-white/55">
        更新 {formatDateTime(session.updatedAt)} / 入力者 {formatParticipantNames(session.participantEmployeeNames)}
      </p>
    </button>
  );
}

function DetailTable({
  session,
  requireMeasuringInstrumentTag
}: {
  session: SelfInspectionRecordApprovalSessionDetailDto;
  requireMeasuringInstrumentTag: boolean;
}) {
  return (
    <div className="min-h-0 overflow-auto rounded border border-white/10">
      <table className="min-w-full text-left text-sm">
        <thead className="sticky top-0 bg-slate-950 text-xs text-white/55">
          <tr>
            <th className="px-3 py-2">入力件</th>
            <th className="px-3 py-2">点検</th>
            <th className="px-3 py-2">丸数字</th>
            <th className="px-3 py-2">測定</th>
            <th className="px-3 py-2">オペレータ値</th>
            <th className="px-3 py-2">検査員値</th>
            <th className="px-3 py-2">差分</th>
            <th className="px-3 py-2">差異判定</th>
            <th className="px-3 py-2">合格範囲</th>
          </tr>
        </thead>
        <tbody>
          {session.requiredEntries.flatMap((entry) =>
            entry.values.map((value, valueIndex) => {
              const isJudgement = value.valueKind === 'judgement';
              const outOfTolerance = !isJudgement && value.isWithinTolerance === false;
              const missing = isJudgement ? value.judgementResult == null : value.value == null;
              const operatorDisplay = isJudgement
                ? value.judgementResult === 'PASS'
                  ? 'OK'
                  : value.judgementResult === 'FAIL'
                    ? 'NG'
                    : '未入力'
                : value.value ?? '未入力';
              const inspectorDisplay = isJudgement
                ? value.inspectorJudgementResult === 'PASS'
                  ? 'OK'
                  : value.inspectorJudgementResult === 'FAIL'
                    ? 'NG'
                    : '未入力'
                : value.inspectorValue ?? '未入力';
              const instrumentUsages = entry.entry?.instrumentUsages ?? [];
              const inspectorInstrumentUsages = entry.inspectorEntry?.instrumentUsages ?? [];
              const legacyInstrumentLabel =
                entry.entry?.measuringInstrumentManagementNumberSnapshot && entry.entry?.measuringInstrumentNameSnapshot
                  ? `${entry.entry.measuringInstrumentManagementNumberSnapshot} ${entry.entry.measuringInstrumentNameSnapshot}`
                  : entry.entry?.measuringInstrumentNameSnapshot;
              const inspectorLegacyInstrumentLabel =
                entry.inspectorEntry?.measuringInstrumentManagementNumberSnapshot &&
                entry.inspectorEntry?.measuringInstrumentNameSnapshot
                  ? `${entry.inspectorEntry.measuringInstrumentManagementNumberSnapshot} ${entry.inspectorEntry.measuringInstrumentNameSnapshot}`
                  : entry.inspectorEntry?.measuringInstrumentNameSnapshot;
              return (
                <tr
                  key={`${entry.entryIndex}:${value.templateItemId}`}
                  className={clsx(
                    'border-t border-white/10',
                    outOfTolerance && 'bg-red-500/10',
                    missing && 'bg-slate-600/15'
                  )}
                >
                  {valueIndex === 0 ? (
                    <td className="whitespace-nowrap px-3 py-2 align-top" rowSpan={entry.values.length}>
                      <div className="font-semibold">{entry.entrySlotLabel}</div>
                      <div className="text-xs text-white/45">#{entry.entryIndex + 1}</div>
                    </td>
                  ) : null}
                  {valueIndex === 0 ? (
                    <td className="min-w-36 px-3 py-2 align-top" rowSpan={entry.values.length}>
                      <div className={entry.entry?.createdByEmployeeNameSnapshot ? 'text-emerald-100' : 'text-amber-100'}>
                        測定者 {entry.entry?.createdByEmployeeNameSnapshot ?? '未登録'}
                      </div>
                      <div className={entry.entry?.updatedAt ? 'text-xs text-white/55' : 'text-xs text-amber-100'}>
                        保存 {entry.entry?.updatedAt ? formatDateTime(entry.entry.updatedAt) : '未保存'}
                      </div>
                      {instrumentUsages.length > 0 ? (
                        <div className="mt-1 grid gap-0.5 text-emerald-100">
                          <div>オペレータ使用前点検済</div>
                          {instrumentUsages.map((usage) => (
                            <div key={usage.id} className="max-w-52 truncate text-xs text-emerald-100/85">
                              {formatInstrumentUsageLabel(usage)}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div
                          className={
                            legacyInstrumentLabel
                              ? 'text-emerald-100'
                              : requireMeasuringInstrumentTag
                                ? 'text-amber-100'
                                : 'text-white/55'
                          }
                        >
                          使用前点検 {legacyInstrumentLabel ?? (requireMeasuringInstrumentTag ? '未点検' : '任意')}
                        </div>
                      )}
                      <div className="mt-2 border-t border-white/10 pt-2">
                        <div className={entry.inspectorEntry?.inspectorEmployeeNameSnapshot ? 'text-sky-100' : 'text-amber-100'}>
                          検査員 {entry.inspectorEntry?.inspectorEmployeeNameSnapshot ?? '未登録'}
                        </div>
                        <div className={entry.inspectorEntry?.updatedAt ? 'text-xs text-white/55' : 'text-xs text-amber-100'}>
                          保存 {entry.inspectorEntry?.updatedAt ? formatDateTime(entry.inspectorEntry.updatedAt) : '未保存'}
                        </div>
                        {inspectorInstrumentUsages.length > 0 ? (
                          <div className="mt-1 grid gap-0.5 text-sky-100">
                            <div>検査員使用前点検済</div>
                            {inspectorInstrumentUsages.map((usage) => (
                              <div key={usage.id} className="max-w-52 truncate text-xs text-sky-100/85">
                                {formatInstrumentUsageLabel(usage)}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div
                            className={
                              inspectorLegacyInstrumentLabel
                                ? 'text-sky-100'
                                : requireMeasuringInstrumentTag
                                  ? 'text-amber-100'
                                  : 'text-white/55'
                            }
                          >
                            検査員使用前点検 {inspectorLegacyInstrumentLabel ?? (requireMeasuringInstrumentTag ? '未点検' : '任意')}
                          </div>
                        )}
                      </div>
                    </td>
                  ) : null}
                  <td className="px-3 py-2">{value.displayMarker ?? '-'}</td>
                  <td className="px-3 py-2">
                    <div className="font-semibold">{value.measurementLabel}</div>
                    <div className="text-xs text-white/50">{value.measurementPoint}</div>
                  </td>
                  <td className={clsx('px-3 py-2 font-mono', outOfTolerance ? 'text-red-100' : missing ? 'text-amber-100' : 'text-white')}>
                    {operatorDisplay}
                    {!isJudgement && value.value && value.unit ? ` ${value.unit}` : ''}
                  </td>
                  <td className={clsx('px-3 py-2 font-mono', (isJudgement ? value.inspectorJudgementResult : value.inspectorValue) == null ? 'text-amber-100' : 'text-sky-100')}>
                    {inspectorDisplay}
                    {!isJudgement && value.inspectorValue && value.unit ? ` ${value.unit}` : ''}
                  </td>
                  <td className="px-3 py-2 font-mono text-white/75">
                    {isJudgement ? '—' : value.differenceValue ?? '-'}
                  </td>
                  <td className="px-3 py-2 text-white/75">
                    {inspectorJudgementLabel(value.inspectorJudgementStatus)}
                  </td>
                  <td className="px-3 py-2 font-mono text-white/75">
                    {isJudgement ? 'OK/NG判定' : `${value.lowerLimit ?? '-'} - ${value.upperLimit ?? '-'}`}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function InvalidationListItem({
  invalidation,
  selected,
  onSelect
}: {
  invalidation: SelfInspectionItemInvalidationDto;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={clsx(
        'grid w-full gap-1 rounded border p-3 text-left transition-colors',
        selected
          ? 'border-rose-300 bg-rose-500/15'
          : 'border-white/15 bg-slate-900/80 hover:border-white/35 hover:bg-slate-800'
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-bold">{invalidation.productNoSnapshot}</p>
          <p className="line-clamp-2 text-xs text-white/65">
            {invalidation.fhincdSnapshot} / {invalidation.fhinmeiSnapshot} / 資源{' '}
            {invalidation.resourceCdSnapshot}
          </p>
        </div>
        <span className="shrink-0 rounded bg-rose-500/20 px-2 py-1 text-xs font-semibold text-rose-100">
          削除済み
        </span>
      </div>
      <p className="line-clamp-2 text-xs text-rose-100/85">{invalidation.reason}</p>
      <p className="text-xs text-white/55">
        {formatDateTime(invalidation.invalidatedAt)} / 削除前{' '}
        {INVALIDATION_STATE_LABELS[invalidation.sourceState]}
      </p>
    </button>
  );
}

function InvalidationHistoryDetail({
  invalidation
}: {
  invalidation: SelfInspectionItemInvalidationDetailDto;
}) {
  const session = invalidation.session;
  const inspectorEntryByIndex = new Map(
    (session?.inspectorEntries ?? []).map((entry) => [entry.entryIndex, entry])
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="rounded border border-rose-300/50 bg-rose-500/15 p-3 text-rose-50">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold">{invalidation.productNoSnapshot}</h2>
              <span className="rounded bg-rose-500/30 px-2 py-1 text-xs font-bold">削除済み・閲覧専用</span>
            </div>
            <p className="text-sm text-rose-100/85">
              {invalidation.fhincdSnapshot} / {invalidation.fhinmeiSnapshot} / 資源{' '}
              {invalidation.resourceCdSnapshot}
              {invalidation.fseibanSnapshot ? ` / 製番 ${invalidation.fseibanSnapshot}` : ''}
            </p>
          </div>
          <div className="text-right text-xs text-rose-100/80">
            <p>削除 {formatDateTime(invalidation.invalidatedAt)}</p>
            <p>削除前 {INVALIDATION_STATE_LABELS[invalidation.sourceState]}</p>
          </div>
        </div>
        <dl className="mt-3 grid gap-x-3 gap-y-1 border-t border-rose-200/20 pt-3 text-sm sm:grid-cols-[7rem_1fr]">
          <dt className="font-semibold text-rose-100/65">削除理由</dt>
          <dd className="whitespace-pre-wrap font-semibold">{invalidation.reason}</dd>
          <dt className="font-semibold text-rose-100/65">実行者</dt>
          <dd>{invalidation.invalidatedByUsernameSnapshot ?? 'キオスク端末'}</dd>
          <dt className="font-semibold text-rose-100/65">端末</dt>
          <dd>
            {invalidation.invalidatedByClientDeviceNameSnapshot ??
              invalidation.invalidatedByClientDeviceId ??
              '—'}
          </dd>
        </dl>
      </div>

      {!session ? (
        <div className="rounded border border-white/15 bg-slate-950/40 py-12 text-center text-white/60">
          未開始で削除されたため、測定履歴はありません。
        </div>
      ) : (
        <>
          <div className="min-h-0 overflow-auto rounded border border-white/10">
            <table className="min-w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-950 text-xs text-white/55">
                <tr>
                  <th className="px-3 py-2">入力件</th>
                  <th className="px-3 py-2">測定点</th>
                  <th className="px-3 py-2">作業者値</th>
                  <th className="px-3 py-2">検査員値</th>
                  <th className="px-3 py-2">入力者</th>
                </tr>
              </thead>
              <tbody>
                {session.entries.flatMap((entry) =>
                  entry.values.map((value, valueIndex) => {
                    const inspectorValue = inspectorEntryByIndex
                      .get(entry.entryIndex)
                      ?.values.find((candidate) => candidate.templateItemId === value.templateItemId);
                    return (
                      <tr key={`${entry.id}:${value.id}`} className="border-t border-white/10">
                        {valueIndex === 0 ? (
                          <td className="whitespace-nowrap px-3 py-2 align-top" rowSpan={entry.values.length}>
                            #{entry.entryIndex + 1}
                          </td>
                        ) : null}
                        <td className="px-3 py-2">
                          <div className="font-semibold">
                            {value.templateItem.displayMarker ?? '—'}{' '}
                            {value.templateItem.measurementLabel}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {value.judgementResult ?? value.value ?? '未入力'}
                          {value.value && value.templateItem.unit ? ` ${value.templateItem.unit}` : ''}
                        </td>
                        <td className="px-3 py-2 font-mono text-sky-100">
                          {inspectorValue?.inspectorJudgementResult ??
                            inspectorValue?.inspectorValue ??
                            '—'}
                        </td>
                        {valueIndex === 0 ? (
                          <td className="px-3 py-2 align-top text-white/70" rowSpan={entry.values.length}>
                            {entry.createdByEmployeeNameSnapshot ?? '未登録'}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded border border-white/10 bg-slate-950/40 p-3">
              <h3 className="font-semibold">承認履歴</h3>
              {session.recordApproval ? (
                <p className="mt-2 text-sm text-white/70">
                  {formatDateTime(session.recordApproval.approvedAt)} /{' '}
                  {session.recordApproval.approverEmployeeNameSnapshot}
                  {session.recordApproval.comment ? ` / ${session.recordApproval.comment}` : ''}
                </p>
              ) : (
                <p className="mt-2 text-sm text-white/50">承認履歴なし</p>
              )}
            </div>
            <div className="rounded border border-white/10 bg-slate-950/40 p-3">
              <h3 className="font-semibold">紙帳票履歴</h3>
              {session.paperReports.length > 0 ? (
                <div className="mt-2 grid gap-1 text-sm text-white/70">
                  {session.paperReports.map((report) => (
                    <p key={report.id}>
                      {formatDateTime(report.issuedAt)} / {report.status} / {report.pages.length}ページ
                    </p>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-white/50">紙帳票履歴なし</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function KioskSelfInspectionRecordApprovalPage() {
  const location = useLocation();
  const [accessGranted, setAccessGranted] = useState(false);
  const [accessMessage, setAccessMessage] = useState<string | null>(null);
  const accessPromptShownRef = useRef(false);
  const verifyAccessPasswordMutation = useVerifyKioskSelfInspectionRecordApprovalAccessPassword();
  const isActiveRoute =
    accessGranted && location.pathname.startsWith('/kiosk/part-measurement/self-inspection/record-approvals');
  const nfcEvent = useNfcStream(Boolean(isActiveRoute));
  const lastProcessedNfcKeyRef = useRef<string | null>(null);
  const [state, setState] = useState<RecordApprovalFilterState>('active');
  const [productNo, setProductNo] = useState('');
  const [resourceCd, setResourceCd] = useState('');
  const requestedSessionId = useMemo(
    () => new URLSearchParams(location.search).get('sessionId'),
    [location.search]
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    () => requestedSessionId
  );
  const [approver, setApprover] = useState<{
    employeeCode: string;
    displayName: string;
    nfcTagUid: string;
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [policyMessage, setPolicyMessage] = useState<string | null>(null);

  const registrationPolicyQuery = useSelfInspectionRegistrationPolicy({
    enabled: accessGranted && state !== 'invalidated'
  });
  const updateRegistrationPolicyMutation = useUpdateSelfInspectionRegistrationPolicy();
  const requireMeasuringInstrumentTag =
    registrationPolicyQuery.data?.requireMeasuringInstrumentTag ?? false;
  const listQuery = useSelfInspectionRecordApprovals({
    state: state === 'invalidated' ? 'active' : state,
    productNo: productNo.trim() || undefined,
    resourceCd: resourceCd.trim() || undefined
  }, { enabled: accessGranted && state !== 'invalidated' });
  const sessions = listQuery.data?.sessions ?? EMPTY_SESSIONS;
  const invalidationListQuery = useSelfInspectionInvalidations(
    {
      productNo: productNo.trim() || undefined,
      resourceCd: resourceCd.trim() || undefined
    },
    { enabled: accessGranted && state === 'invalidated' }
  );
  const invalidations =
    invalidationListQuery.data?.invalidations ?? EMPTY_INVALIDATIONS;
  const detailQuery = useSelfInspectionRecordApprovalSession(selectedSessionId, {
    enabled: accessGranted && state !== 'invalidated' && Boolean(selectedSessionId)
  });
  const invalidationDetailQuery = useSelfInspectionInvalidation(selectedSessionId, {
    enabled: accessGranted && state === 'invalidated' && Boolean(selectedSessionId)
  });
  const resolveApproverMutation = useResolveSelfInspectionRecordApprovalApprover();
  const approveMutation = useApproveSelfInspectionRecordApproval();
  const selectedSession = detailQuery.data ?? null;
  const selectedInvalidation = invalidationDetailQuery.data ?? null;

  const requestAccessPassword = useCallback(async () => {
    const password = typeof window !== 'undefined' ? window.prompt('検査記録確認パスワードを入力してください') : null;
    if (!password) {
      setAccessMessage('検査記録確認にはパスワード認証が必要です。');
      return;
    }
    try {
      const result = await verifyAccessPasswordMutation.mutateAsync({ password });
      if (!result.success) {
        setAccessMessage('パスワードが違います。');
        window.alert('パスワードが違います');
        return;
      }
      setAccessMessage(null);
      setAccessGranted(true);
    } catch {
      setAccessMessage('認証に失敗しました。ネットワーク接続を確認してください。');
      window.alert('認証に失敗しました。ネットワーク接続を確認してください。');
    }
  }, [verifyAccessPasswordMutation]);

  useEffect(() => {
    if (accessGranted || accessPromptShownRef.current) return;
    accessPromptShownRef.current = true;
    void requestAccessPassword();
  }, [accessGranted, requestAccessPassword]);

  useEffect(() => {
    if (state === 'invalidated') {
      if (invalidations.length === 0) {
        if (!invalidationListQuery.isLoading) setSelectedSessionId(null);
        return;
      }
      if (
        !selectedSessionId ||
        !invalidations.some((invalidation) => invalidation.id === selectedSessionId)
      ) {
        setSelectedSessionId(invalidations[0].id);
      }
      return;
    }
    if (sessions.length === 0) {
      if (!listQuery.isLoading && !requestedSessionId) {
        setSelectedSessionId(null);
      }
      return;
    }
    if (requestedSessionId && selectedSessionId === requestedSessionId) return;
    if (!selectedSessionId || !sessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [
    invalidationListQuery.isLoading,
    invalidations,
    listQuery.isLoading,
    requestedSessionId,
    selectedSessionId,
    sessions,
    state
  ]);

  useEffect(() => {
    if (state === 'invalidated') return;
    if (selectedSession?.decisionWorkflow === 'INSPECTOR_FINAL_JUDGEMENT') return;
    if (!nfcEvent?.uid) return;
    const key = `${nfcEvent.uid}:${nfcEvent.timestamp ?? ''}`;
    if (lastProcessedNfcKeyRef.current === key) return;
    lastProcessedNfcKeyRef.current = key;
    setStatusMessage('承認者NFCを確認中です。');
    void resolveApproverMutation
      .mutateAsync({ uid: nfcEvent.uid })
      .then((result) => {
        if (result.kind === 'employee') {
          setApprover(result.employee);
          setStatusMessage(`${result.employee.displayName} を承認者として読み取りました。`);
          return;
        }
        setApprover(null);
        if (result.kind === 'inactive') {
          setStatusMessage('有効な社員タグではありません。');
        } else if (result.kind === 'instrument') {
          setStatusMessage('計測機器タグでは承認できません。社員タグをタッチしてください。');
        } else if (result.kind === 'duplicate') {
          setStatusMessage('同一タグが社員と計測機器の両方に登録されています。');
        } else {
          setStatusMessage('未登録のNFCタグです。');
        }
      })
      .catch((error: unknown) => {
        setApprover(null);
        setStatusMessage(readApiErrorMessage(error, '承認者NFCの確認に失敗しました。'));
      });
  }, [nfcEvent, resolveApproverMutation, selectedSession?.decisionWorkflow, state]);

  const isInspectorFinalJudgement =
    selectedSession?.decisionWorkflow === 'INSPECTOR_FINAL_JUDGEMENT';
  const canApprove =
    !isInspectorFinalJudgement &&
    selectedSession?.recordApprovalState === 'approvable' &&
    approver != null;
  const approveDisabledReason = useMemo(() => {
    if (!selectedSession) return '承認する検査記録を選択してください。';
    if (selectedSession.recordApprovalState === 'inspector_measurement_pending') {
      return '検査員再測定がそろうと承認できます。';
    }
    if (selectedSession.recordApprovalState !== 'approvable') return '入力と使用前点検がそろうと承認できます。';
    if (!approver) return '承認者の社員NFCタグをタッチしてください。';
    return null;
  }, [approver, selectedSession]);
  const inspectorWorkflowAction = useMemo(() => {
    if (!selectedSession || !isInspectorFinalJudgement) return null;
    switch (selectedSession.recordApprovalState) {
      case 'input_incomplete':
        return {
          href: kioskSelfInspectionSessionPath(selectedSession.id),
          label: '作業者入力へ'
        };
      case 'registration_incomplete':
        return selectedSession.inspectorIncompleteRegistrationEntryCount > 0
          ? {
              href: kioskSelfInspectionInspectorSessionPath(selectedSession.id),
              label: '検査員点検へ'
            }
          : {
              href: kioskSelfInspectionSessionPath(selectedSession.id),
              label: '作業者点検へ'
            };
      case 'inspector_measurement_pending':
        return {
          href: kioskSelfInspectionInspectorSessionPath(selectedSession.id),
          label: '検査員測定へ'
        };
      case 'final_judgement_pending':
        return {
          href: kioskSelfInspectionInspectorSessionPath(selectedSession.id),
          label: '最終判定へ'
        };
      case 'finalization_ready':
        return {
          href: kioskSelfInspectionInspectorSessionPath(selectedSession.id),
          label: '最終確定へ'
        };
      default:
        return null;
    }
  }, [isInspectorFinalJudgement, selectedSession]);

  const approveSelectedSession = async () => {
    if (!selectedSession || !approver || !canApprove) return;
    setStatusMessage(null);
    try {
      await approveMutation.mutateAsync({
        sessionId: selectedSession.id,
        approverEmployeeTagUid: approver.nfcTagUid,
        comment: null
      });
      setStatusMessage('検査記録を承認し、自主検査を完了しました。');
      setApprover(null);
    } catch (error: unknown) {
      setStatusMessage(readApiErrorMessage(error, '承認処理に失敗しました。'));
    }
  };

  if (!accessGranted) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 bg-slate-800 p-3 text-white">
        <div className="rounded border border-white/15 bg-slate-900/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">検査記録確認</h1>
              <p className="mt-1 text-sm text-white/65">
                {accessMessage ?? 'パスワード認証中です。'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={verifyAccessPasswordMutation.isPending}
                onClick={() => void requestAccessPassword()}
              >
                認証する
              </Button>
              <Link
                to="/kiosk/part-measurement/self-inspection"
                className={buttonClassName('ghostOnDark', 'inline-flex items-center justify-center')}
              >
                戻る
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const toggleMeasuringInstrumentRequirement = async () => {
    const next = !requireMeasuringInstrumentTag;
    setPolicyMessage(null);
    try {
      await updateRegistrationPolicyMutation.mutateAsync({
        requireMeasuringInstrumentTag: next
      });
      setPolicyMessage(`計測機器の使用前点検必須を${next ? 'ON' : 'OFF'}にしました。`);
    } catch (error: unknown) {
      setPolicyMessage(readApiErrorMessage(error, '計測機器の使用前点検必須の切替に失敗しました。'));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 bg-slate-800 p-3 text-white">
      <div className="rounded border border-white/15 bg-slate-900/70 p-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">検査記録確認</h1>
            <p className="mt-1 text-sm text-white/65">
              作業者・検査員の入力値と、承認・最終判定の進捗を確認します。
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {state !== 'invalidated' ? (
              <div className="grid gap-1 text-sm">
              <span className="text-white/65">計測機器の使用前点検必須</span>
              <button
                type="button"
                aria-label={`計測機器の使用前点検必須 ${requireMeasuringInstrumentTag ? 'ON' : 'OFF'}`}
                aria-pressed={requireMeasuringInstrumentTag}
                disabled={registrationPolicyQuery.isLoading || updateRegistrationPolicyMutation.isPending}
                onClick={() => void toggleMeasuringInstrumentRequirement()}
                className={clsx(
                  'inline-flex h-10 items-center gap-2 rounded border px-3 text-sm font-semibold transition-colors',
                  requireMeasuringInstrumentTag
                    ? 'border-amber-300/50 bg-amber-400/20 text-amber-100'
                    : 'border-white/15 bg-slate-950/70 text-white/75 hover:border-white/35',
                  (registrationPolicyQuery.isLoading || updateRegistrationPolicyMutation.isPending) && 'opacity-60'
                )}
              >
                <span
                  className={clsx(
                    'relative inline-flex h-5 w-9 rounded-full border transition-colors',
                    requireMeasuringInstrumentTag ? 'border-amber-200/70 bg-amber-300/80' : 'border-white/20 bg-white/10'
                  )}
                >
                  <span
                    className={clsx(
                      'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform',
                      requireMeasuringInstrumentTag ? 'translate-x-4' : 'translate-x-0.5'
                    )}
                  />
                </span>
                {requireMeasuringInstrumentTag ? 'ON' : 'OFF'}
              </button>
              {policyMessage ? <span className="max-w-48 text-xs text-amber-100">{policyMessage}</span> : null}
              </div>
            ) : null}
            <label className="grid gap-1 text-sm">
              <span className="text-white/65">状態</span>
              <select
                className="rounded border border-white/15 bg-slate-950/70 px-3 py-2 text-white"
                value={state}
                onChange={(event) => {
                  setState(event.target.value as RecordApprovalFilterState);
                  setSelectedSessionId(null);
                  setApprover(null);
                  setStatusMessage(null);
                }}
              >
                {STATE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid min-w-44 gap-1 text-sm">
              <span className="text-white/65">製造order</span>
              <input
                className="rounded border border-white/15 bg-slate-950/70 px-3 py-2 text-white"
                value={productNo}
                onChange={(event) => setProductNo(event.target.value)}
                placeholder="製造order"
              />
            </label>
            <label className="grid w-28 gap-1 text-sm">
              <span className="text-white/65">資源CD</span>
              <input
                className="rounded border border-white/15 bg-slate-950/70 px-3 py-2 text-white"
                value={resourceCd}
                onChange={(event) => setResourceCd(event.target.value)}
                placeholder="581"
              />
            </label>
            <Button type="button" variant="ghostOnDark" onClick={() => { setProductNo(''); setResourceCd(''); }}>
              クリア
            </Button>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[22rem_1fr]">
        <aside className="min-h-0 overflow-auto rounded border border-white/15 bg-slate-950/45 p-2">
          {state === 'invalidated' ? (
            invalidationListQuery.isLoading && invalidations.length === 0 ? (
              <div className="py-10 text-center text-white/55">削除履歴を読込中...</div>
            ) : invalidations.length === 0 ? (
              <div className="py-10 text-center text-white/55">削除済みの自主検査はありません。</div>
            ) : (
              <div className="grid gap-2">
                {invalidations.map((invalidation) => (
                  <InvalidationListItem
                    key={invalidation.id}
                    invalidation={invalidation}
                    selected={invalidation.id === selectedSessionId}
                    onSelect={() => {
                      setSelectedSessionId(invalidation.id);
                      setApprover(null);
                      setStatusMessage(null);
                    }}
                  />
                ))}
              </div>
            )
          ) : listQuery.isLoading && sessions.length === 0 ? (
            <div className="py-10 text-center text-white/55">読込中...</div>
          ) : sessions.length === 0 ? (
            <div className="py-10 text-center text-white/55">対象の検査記録はありません。</div>
          ) : (
            <div className="grid gap-2">
              {sessions.map((session) => (
                <SessionListItem
                  key={session.id}
                  session={session}
                  selected={session.id === selectedSessionId}
                  onSelect={() => {
                    setSelectedSessionId(session.id);
                    setApprover(null);
                    setStatusMessage(null);
                  }}
                />
              ))}
            </div>
          )}
        </aside>

        <section className="flex min-h-0 flex-col gap-3 rounded border border-white/15 bg-slate-900/70 p-3">
          {state === 'invalidated' ? (
            !selectedSessionId ? (
              <div className="py-16 text-center text-white/55">左の一覧から削除履歴を選択してください。</div>
            ) : invalidationDetailQuery.isLoading && !selectedInvalidation ? (
              <div className="py-16 text-center text-white/55">削除履歴の詳細を読込中...</div>
            ) : !selectedInvalidation ? (
              <div className="py-16 text-center text-white/55">削除履歴を表示できません。</div>
            ) : (
              <InvalidationHistoryDetail invalidation={selectedInvalidation} />
            )
          ) : !selectedSessionId ? (
            <div className="py-16 text-center text-white/55">左の一覧から検査記録を選択してください。</div>
          ) : detailQuery.isLoading && !selectedSession ? (
            <div className="py-16 text-center text-white/55">詳細を読込中...</div>
          ) : !selectedSession ? (
            <div className="py-16 text-center text-white/55">検査記録を表示できません。</div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-bold">{selectedSession.productNo}</h2>
                    <span className={clsx('rounded px-2 py-1 text-xs font-semibold', stateClassName(selectedSession.recordApprovalState))}>
                      {stateLabel(selectedSession.recordApprovalState)}
                    </span>
                  </div>
                  <p className="text-sm text-white/65">
                    {selectedSession.fhincd} / {selectedSession.fhinmei} / 資源 {selectedSession.resourceCd}
                    {selectedSession.fseiban ? ` / 製番 ${selectedSession.fseiban}` : ''}
                  </p>
                  <p className="text-xs text-white/50">
                    入力 {selectedSession.completedRequiredEntryCount}/{selectedSession.requiredEntryCount}件
                    {isInspectorFinalJudgement
                      ? ` / 最終判定待ち ${selectedSession.pendingReviewCount}点`
                      : ` / 公差外承認待ち ${selectedSession.pendingReviewCount}点`}
                    {selectedSession.recordApproval
                      ? ` / 承認 ${formatDateTime(selectedSession.recordApproval.approvedAt)} ${selectedSession.recordApproval.approverEmployeeNameSnapshot}`
                      : ''}
                  </p>
                  <p className="text-xs text-white/50">
                    更新 {formatDateTime(selectedSession.updatedAt)} / 入力者 {formatParticipantNames(selectedSession.participantEmployeeNames)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    to={kioskSelfInspectionSessionPath(selectedSession.id)}
                    className={buttonClassName('ghostOnDark', 'inline-flex items-center justify-center')}
                  >
                    入力画面
                  </Link>
                  <Link
                    to={kioskSelfInspectionInspectorSessionPath(selectedSession.id)}
                    className={buttonClassName('secondary', 'inline-flex items-center justify-center')}
                  >
                    検査員画面
                  </Link>
                </div>
              </div>

              {isInspectorFinalJudgement ? (
                <div className="grid gap-2 rounded border border-cyan-300/20 bg-cyan-500/10 p-3 md:grid-cols-[1fr_auto]">
                  <div>
                    <p className="text-sm font-semibold text-cyan-100">
                      検査員最終判定フロー（閲覧専用）
                    </p>
                    <p className="mt-1 text-xs text-white/65">
                      この画面では作業者・検査員の入力結果を変更しません。必要な測定・最終判定・確定は検査員画面で行います。
                    </p>
                  </div>
                  {inspectorWorkflowAction ? (
                    <Link
                      to={inspectorWorkflowAction.href}
                      className={buttonClassName(
                        'secondary',
                        'inline-flex min-w-44 items-center justify-center self-end'
                      )}
                    >
                      {inspectorWorkflowAction.label}
                    </Link>
                  ) : (
                    <span className="self-end rounded bg-emerald-400/20 px-3 py-2 text-sm font-semibold text-emerald-100">
                      最終確定済み
                    </span>
                  )}
                </div>
              ) : (
                <div className="grid gap-2 rounded border border-white/10 bg-slate-950/40 p-3 md:grid-cols-[1fr_auto]">
                  <div>
                    <p className="text-sm font-semibold text-white/80">承認者NFC</p>
                    <p className={clsx('mt-1 rounded border px-3 py-2 text-sm', approver ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100' : 'border-white/15 bg-white/5 text-white/55')}>
                      {approver ? `${approver.employeeCode} ${approver.displayName}` : '社員タグをタッチしてください'}
                    </p>
                    {statusMessage ? (
                      <p className="mt-2 rounded border border-amber-400/40 bg-amber-500/15 px-3 py-2 text-sm text-amber-100">
                        {statusMessage}
                      </p>
                    ) : approveDisabledReason ? (
                      <p className="mt-2 text-xs text-white/55">{approveDisabledReason}</p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    disabled={!canApprove || approveMutation.isPending}
                    onClick={() => void approveSelectedSession()}
                    className="min-w-44 self-end"
                  >
                    承認して完了
                  </Button>
                </div>
              )}

              <DetailTable
                session={selectedSession}
                requireMeasuringInstrumentTag={requireMeasuringInstrumentTag}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
