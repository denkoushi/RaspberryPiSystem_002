import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import {
  useApproveSelfInspectionRecordApproval,
  useResolveSelfInspectionRecordApprovalApprover,
  useSelfInspectionRecordApprovalSession,
  useSelfInspectionRecordApprovals
} from '../../api/hooks';
import { buttonClassName, Button } from '../../components/ui/Button';
import { kioskSelfInspectionSessionPath } from '../../features/part-measurement/selfInspectionRoutes';
import { useNfcStream } from '../../hooks/useNfcStream';

import type {
  SelfInspectionRecordApprovalSessionDetailDto,
  SelfInspectionRecordApprovalSessionListItemDto,
  SelfInspectionRecordApprovalState
} from '../../features/part-measurement/types';

type RecordApprovalFilterState = 'active' | SelfInspectionRecordApprovalState;

const EMPTY_SESSIONS: SelfInspectionRecordApprovalSessionListItemDto[] = [];

const STATE_OPTIONS: Array<{ value: RecordApprovalFilterState; label: string }> = [
  { value: 'active', label: '未完了' },
  { value: 'input_incomplete', label: '入力途中' },
  { value: 'registration_incomplete', label: '登録不足' },
  { value: 'approvable', label: '承認可能' },
  { value: 'approved', label: '承認済み' }
];

function stateLabel(state: SelfInspectionRecordApprovalState): string {
  switch (state) {
    case 'approved':
      return '承認済み';
    case 'approvable':
      return '承認可能';
    case 'registration_incomplete':
      return '登録不足';
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
    case 'registration_incomplete':
      return 'bg-amber-400/25 text-amber-100';
    case 'input_incomplete':
    default:
      return 'bg-slate-500/35 text-white/80';
  }
}

function formatDateTime(raw: string | null): string {
  if (!raw) return '-';
  return new Date(raw).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
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
        {session.incompleteRegistrationEntryCount > 0 ? ` / 登録不足 ${session.incompleteRegistrationEntryCount}件` : ''}
        {session.pendingReviewCount > 0 ? ` / 公差外 ${session.pendingReviewCount}点` : ''}
      </p>
    </button>
  );
}

function DetailTable({ session }: { session: SelfInspectionRecordApprovalSessionDetailDto }) {
  return (
    <div className="min-h-0 overflow-auto rounded border border-white/10">
      <table className="min-w-full text-left text-sm">
        <thead className="sticky top-0 bg-slate-950 text-xs text-white/55">
          <tr>
            <th className="px-3 py-2">入力件</th>
            <th className="px-3 py-2">登録</th>
            <th className="px-3 py-2">丸数字</th>
            <th className="px-3 py-2">測定</th>
            <th className="px-3 py-2">値</th>
            <th className="px-3 py-2">合格範囲</th>
          </tr>
        </thead>
        <tbody>
          {session.requiredEntries.flatMap((entry) =>
            entry.values.map((value, valueIndex) => {
              const outOfTolerance = value.isWithinTolerance === false;
              const missing = value.value == null;
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
                      <div className={entry.entry?.measuringInstrumentNameSnapshot ? 'text-emerald-100' : 'text-amber-100'}>
                        機器 {entry.entry?.measuringInstrumentNameSnapshot ?? '未登録'}
                      </div>
                    </td>
                  ) : null}
                  <td className="px-3 py-2">{value.displayMarker ?? '-'}</td>
                  <td className="px-3 py-2">
                    <div className="font-semibold">{value.measurementLabel}</div>
                    <div className="text-xs text-white/50">{value.measurementPoint}</div>
                  </td>
                  <td className={clsx('px-3 py-2 font-mono', outOfTolerance ? 'text-red-100' : missing ? 'text-amber-100' : 'text-white')}>
                    {value.value ?? '未入力'}
                    {value.value && value.unit ? ` ${value.unit}` : ''}
                  </td>
                  <td className="px-3 py-2 font-mono text-white/75">
                    {value.lowerLimit ?? '-'} - {value.upperLimit ?? '-'}
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

export function KioskSelfInspectionRecordApprovalPage() {
  const location = useLocation();
  const isActiveRoute = location.pathname.startsWith('/kiosk/part-measurement/self-inspection/record-approvals');
  const nfcEvent = useNfcStream(Boolean(isActiveRoute));
  const lastProcessedNfcKeyRef = useRef<string | null>(null);
  const [state, setState] = useState<RecordApprovalFilterState>('active');
  const [productNo, setProductNo] = useState('');
  const [resourceCd, setResourceCd] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [approver, setApprover] = useState<{
    employeeCode: string;
    displayName: string;
    nfcTagUid: string;
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const listQuery = useSelfInspectionRecordApprovals({
    state,
    productNo: productNo.trim() || undefined,
    resourceCd: resourceCd.trim() || undefined
  });
  const sessions = listQuery.data?.sessions ?? EMPTY_SESSIONS;
  const detailQuery = useSelfInspectionRecordApprovalSession(selectedSessionId, {
    enabled: Boolean(selectedSessionId)
  });
  const resolveApproverMutation = useResolveSelfInspectionRecordApprovalApprover();
  const approveMutation = useApproveSelfInspectionRecordApproval();

  useEffect(() => {
    if (sessions.length === 0) {
      setSelectedSessionId(null);
      return;
    }
    if (!selectedSessionId || !sessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [selectedSessionId, sessions]);

  useEffect(() => {
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
  }, [nfcEvent, resolveApproverMutation]);

  const selectedSession = detailQuery.data ?? null;
  const canApprove = selectedSession?.recordApprovalState === 'approvable' && approver != null;
  const approveDisabledReason = useMemo(() => {
    if (!selectedSession) return '承認する検査記録を選択してください。';
    if (selectedSession.recordApprovalState !== 'approvable') return '入力と登録がそろうと承認できます。';
    if (!approver) return '承認者の社員NFCタグをタッチしてください。';
    return null;
  }, [approver, selectedSession]);

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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 bg-slate-800 p-3 text-white">
      <div className="rounded border border-white/15 bg-slate-900/70 p-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">検査記録確認</h1>
            <p className="mt-1 text-sm text-white/65">
              入力途中、登録不足、承認可能な自主検査を確認します。
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-sm">
              <span className="text-white/65">状態</span>
              <select
                className="rounded border border-white/15 bg-slate-950/70 px-3 py-2 text-white"
                value={state}
                onChange={(event) => setState(event.target.value as RecordApprovalFilterState)}
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
          {listQuery.isLoading && sessions.length === 0 ? (
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
          {!selectedSessionId ? (
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
                    入力 {selectedSession.completedRequiredEntryCount}/{selectedSession.requiredEntryCount}件 / 公差外承認待ち {selectedSession.pendingReviewCount}点
                    {selectedSession.recordApproval
                      ? ` / 承認 ${formatDateTime(selectedSession.recordApproval.approvedAt)} ${selectedSession.recordApproval.approverEmployeeNameSnapshot}`
                      : ''}
                  </p>
                </div>
                <Link
                  to={kioskSelfInspectionSessionPath(selectedSession.id)}
                  className={buttonClassName('ghostOnDark', 'inline-flex items-center justify-center')}
                >
                  入力画面
                </Link>
              </div>

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

              <DetailTable session={selectedSession} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
