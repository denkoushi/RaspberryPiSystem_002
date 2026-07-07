import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';

import {
  approveAssemblyWorkSessionRecordApproval,
  getAssemblyWorkSession,
  listAssemblyWorkSessionSummaries,
  resolveAssemblyOperatorNfc,
  verifyKioskAssemblyRecordApprovalAccessPassword
} from '../../api/client';
import { buttonClassName, Button } from '../../components/ui/Button';
import {
  KIOSK_ASSEMBLY_HOME_PATH,
  readAssemblyApiErrorMessage
} from '../../features/assembly';
import { useNfcStream } from '../../hooks/useNfcStream';

import type { AssemblyWorkSessionDto, AssemblyWorkSessionSummaryDto } from '../../features/assembly/types';

type ApprovalFilter = 'all' | 'pending' | 'approved';

const FILTER_OPTIONS: Array<{ value: ApprovalFilter; label: string }> = [
  { value: 'all', label: 'すべて' },
  { value: 'pending', label: '未承認' },
  { value: 'approved', label: '承認済み' }
];

function formatDateTime(raw: string | null): string {
  if (!raw) return '-';
  return new Date(raw).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

function SessionListItem({
  session,
  selected,
  onSelect
}: {
  session: AssemblyWorkSessionSummaryDto;
  selected: boolean;
  onSelect: () => void;
}) {
  const approved = session.approval != null;
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
            {session.targetUnit} / {session.serialNo}
          </p>
        </div>
        <span
          className={clsx(
            'shrink-0 rounded px-2 py-1 text-xs font-semibold',
            approved ? 'bg-emerald-400/20 text-emerald-100' : 'bg-amber-400/25 text-amber-100'
          )}
        >
          {approved ? '承認済み' : '未承認'}
        </span>
      </div>
      <p className="text-xs text-white/55">
        完了 {formatDateTime(session.completedAt)} / 作業者 {session.operatorNameSnapshot}
      </p>
    </button>
  );
}

function DetailPane({
  session,
  approver,
  statusMessage,
  approving,
  onApprove
}: {
  session: AssemblyWorkSessionDto;
  approver: { displayName: string; employeeId: string; nfcTagUid: string } | null;
  statusMessage: string | null;
  approving: boolean;
  onApprove: () => void;
}) {
  const approved = session.approval != null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded border border-white/15 bg-slate-900/70 p-3">
      <div>
        <h2 className="text-xl font-bold">{session.productNo}</h2>
        <p className="mt-1 text-sm text-white/65">
          {session.targetUnit} / {session.serialNo} / {session.template.name}
        </p>
      </div>

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-white/55">作業者</dt>
          <dd className="font-semibold">{session.operatorNameSnapshot}</dd>
        </div>
        <div>
          <dt className="text-white/55">完了日時</dt>
          <dd className="font-semibold">{formatDateTime(session.completedAt)}</dd>
        </div>
        <div>
          <dt className="text-white/55">締付完了</dt>
          <dd className="font-semibold">
            {session.areaTorqueSummaries.reduce((sum, area) => sum + area.acceptedOkCount, 0)}/
            {session.areaTorqueSummaries.reduce((sum, area) => sum + area.totalBoltCount, 0)} 箇所
          </dd>
        </div>
        <div>
          <dt className="text-white/55">承認状態</dt>
          <dd className="font-semibold">{approved ? '承認済み' : '未承認'}</dd>
        </div>
      </dl>

      <section>
        <h3 className="mb-2 text-sm font-bold text-white/80">エリア別トルク実績</h3>
        <div className="overflow-x-auto rounded border border-white/10">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-950/70 text-white/60">
              <tr>
                <th className="px-3 py-2">工程</th>
                <th className="px-3 py-2">エリア</th>
                <th className="px-3 py-2">OK</th>
                <th className="px-3 py-2">NG</th>
                <th className="px-3 py-2">無視</th>
              </tr>
            </thead>
            <tbody>
              {session.areaTorqueSummaries.map((area) => (
                <tr key={area.areaId} className="border-t border-white/10">
                  <td className="px-3 py-2">{area.processNo}</td>
                  <td className="px-3 py-2">{area.areaName}</td>
                  <td className="px-3 py-2 font-mono">{area.acceptedOkCount}/{area.totalBoltCount}</td>
                  <td className="px-3 py-2 font-mono">{area.ngCount}</td>
                  <td className="px-3 py-2 font-mono">{area.ignoredCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {approved ? (
        <div className="rounded border border-emerald-300/30 bg-emerald-500/10 p-3 text-sm">
          <p className="font-semibold text-emerald-100">
            承認者: {session.approval?.approverEmployeeNameSnapshot}
          </p>
          <p className="mt-1 text-emerald-100/80">承認日時: {formatDateTime(session.approval?.approvedAt ?? null)}</p>
        </div>
      ) : (
        <div className="rounded border border-white/15 bg-slate-950/60 p-3">
          <p className="text-sm font-semibold text-white/80">承認者NFC</p>
          <p className="mt-1 text-sm text-white/65">
            {approver ? `${approver.displayName} を承認者として読み取りました。` : '社員タグをタッチしてください。'}
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-3 min-h-11"
            disabled={!approver || approving}
            onClick={onApprove}
          >
            {approving ? '承認中…' : '承認して完了'}
          </Button>
        </div>
      )}

      {statusMessage ? <p className="text-sm font-semibold text-amber-200">{statusMessage}</p> : null}
    </div>
  );
}

export function KioskAssemblyRecordApprovalPage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const initialSessionId = searchParams.get('sessionId');
  const [accessGranted, setAccessGranted] = useState(false);
  const [accessMessage, setAccessMessage] = useState<string | null>(null);
  const accessPromptShownRef = useRef(false);
  const [verifyingPassword, setVerifyingPassword] = useState(false);
  const isActiveRoute = accessGranted && location.pathname.startsWith('/kiosk/assembly/record-approvals');
  const nfcEvent = useNfcStream(Boolean(isActiveRoute));
  const lastProcessedNfcKeyRef = useRef<string | null>(null);
  const [filter, setFilter] = useState<ApprovalFilter>('all');
  const [sessions, setSessions] = useState<AssemblyWorkSessionSummaryDto[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(initialSessionId);
  const [detail, setDetail] = useState<AssemblyWorkSessionDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [approver, setApprover] = useState<{ displayName: string; employeeId: string; nfcTagUid: string } | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  const requestAccessPassword = useCallback(async () => {
    const password = typeof window !== 'undefined' ? window.prompt('組立記録確認パスワードを入力してください') : null;
    if (!password) {
      setAccessMessage('組立記録確認にはパスワード認証が必要です。');
      return;
    }
    setVerifyingPassword(true);
    try {
      const result = await verifyKioskAssemblyRecordApprovalAccessPassword({ password });
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
    } finally {
      setVerifyingPassword(false);
    }
  }, []);

  useEffect(() => {
    if (accessGranted || accessPromptShownRef.current) return;
    accessPromptShownRef.current = true;
    void requestAccessPassword();
  }, [accessGranted, requestAccessPassword]);

  const reloadSessions = useCallback(async () => {
    setListLoading(true);
    try {
      const next = await listAssemblyWorkSessionSummaries({ status: 'completed', limit: 50 });
      setSessions(next);
    } catch (error: unknown) {
      setStatusMessage(readAssemblyApiErrorMessage(error, '完了した製品の取得に失敗しました。'));
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accessGranted) return;
    void reloadSessions();
  }, [accessGranted, reloadSessions]);

  const filteredSessions = useMemo(() => {
    if (filter === 'pending') return sessions.filter((session) => session.approval == null);
    if (filter === 'approved') return sessions.filter((session) => session.approval != null);
    return sessions;
  }, [filter, sessions]);

  useEffect(() => {
    if (!accessGranted) return;
    if (filteredSessions.length === 0) {
      setSelectedSessionId(null);
      return;
    }
    if (initialSessionId && filteredSessions.some((session) => session.id === initialSessionId)) {
      setSelectedSessionId(initialSessionId);
      return;
    }
    if (!selectedSessionId || !filteredSessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(filteredSessions[0].id);
    }
  }, [accessGranted, filteredSessions, initialSessionId, selectedSessionId]);

  useEffect(() => {
    if (!accessGranted || !selectedSessionId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void getAssemblyWorkSession(selectedSessionId)
      .then((session) => {
        if (!cancelled) {
          setDetail(session);
          setApprover(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDetail(null);
          setStatusMessage(readAssemblyApiErrorMessage(error, '詳細の取得に失敗しました。'));
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessGranted, selectedSessionId]);

  useEffect(() => {
    if (!nfcEvent?.uid || detail?.approval) return;
    const key = `${nfcEvent.uid}:${nfcEvent.timestamp ?? ''}`;
    if (lastProcessedNfcKeyRef.current === key) return;
    lastProcessedNfcKeyRef.current = key;
    setStatusMessage('承認者NFCを確認中です。');
    void resolveAssemblyOperatorNfc(nfcEvent.uid)
      .then((result) => {
        setApprover({
          employeeId: result.employeeId,
          displayName: result.displayName,
          nfcTagUid: nfcEvent.uid
        });
        setStatusMessage(`${result.displayName} を承認者として読み取りました。`);
      })
      .catch(() => {
        setApprover(null);
        setStatusMessage('未登録のNFCタグです。');
      });
  }, [detail?.approval, nfcEvent]);

  const approveSelectedSession = async () => {
    if (!detail || !approver || detail.approval) return;
    setApproving(true);
    setStatusMessage(null);
    try {
      const updated = await approveAssemblyWorkSessionRecordApproval(detail.id, {
        approverEmployeeTagUid: approver.nfcTagUid
      });
      setDetail(updated);
      setApprover(null);
      setStatusMessage('組立記録を承認しました。');
      await reloadSessions();
    } catch (error: unknown) {
      setStatusMessage(readAssemblyApiErrorMessage(error, '承認処理に失敗しました。'));
    } finally {
      setApproving(false);
    }
  };

  if (!accessGranted) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 bg-slate-800 p-3 text-white">
        <div className="rounded border border-white/15 bg-slate-900/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">組立記録確認</h1>
              <p className="mt-1 text-sm text-white/65">{accessMessage ?? 'パスワード認証中です。'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled={verifyingPassword} onClick={() => void requestAccessPassword()}>
                認証する
              </Button>
              <Link to={KIOSK_ASSEMBLY_HOME_PATH} className={buttonClassName('ghostOnDark', 'inline-flex items-center justify-center')}>
                戻る
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 bg-slate-800 p-3 text-white">
      <div className="rounded border border-white/15 bg-slate-900/70 p-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">組立記録確認</h1>
            <p className="mt-1 text-sm text-white/65">完了した組立製品の記録を確認し、NFCで承認します。</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-sm">
              <span className="text-white/65">状態</span>
              <select
                className="rounded border border-white/15 bg-slate-950/70 px-3 py-2 text-white"
                value={filter}
                onChange={(event) => setFilter(event.target.value as ApprovalFilter)}
              >
                {FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <Button type="button" variant="ghostOnDark" disabled={listLoading} onClick={() => void reloadSessions()}>
              {listLoading ? '更新中…' : '再読込'}
            </Button>
            <Link to={KIOSK_ASSEMBLY_HOME_PATH} className={buttonClassName('ghostOnDark', 'inline-flex min-h-10 items-center justify-center')}>
              戻る
            </Link>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-2 overflow-hidden rounded border border-white/15 bg-slate-900/70 p-2">
          <p className="px-1 text-sm font-semibold text-white/70">{filteredSessions.length}件</p>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            {filteredSessions.length === 0 ? (
              <p className="rounded border border-white/10 bg-slate-950/60 px-3 py-6 text-center text-sm text-white/55">
                {listLoading ? '読込中…' : '該当する完了製品がありません'}
              </p>
            ) : (
              filteredSessions.map((session) => (
                <SessionListItem
                  key={session.id}
                  session={session}
                  selected={session.id === selectedSessionId}
                  onSelect={() => setSelectedSessionId(session.id)}
                />
              ))
            )}
          </div>
        </section>

        {detailLoading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center rounded border border-white/15 bg-slate-900/70 p-6 text-sm text-white/60">
            詳細を読込中…
          </div>
        ) : detail ? (
          <DetailPane
            session={detail}
            approver={approver}
            statusMessage={statusMessage}
            approving={approving}
            onApprove={() => void approveSelectedSession()}
          />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center rounded border border-white/15 bg-slate-900/70 p-6 text-sm text-white/60">
            確認する完了製品を選択してください。
          </div>
        )}
      </div>
    </div>
  );
}
