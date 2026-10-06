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
  readAssemblyApiErrorMessage,
  resolveAssemblyCheckSummary
} from '../../features/assembly';
import { KioskPinDialog, kioskPinErrorResult } from '../../features/kiosk/KioskPinDialog';
import { useNfcStream } from '../../hooks/useNfcStream';

import type { AssemblyWorkSessionDto, AssemblyWorkSessionSummaryDto } from '../../features/assembly/types';

type ApprovalFilter = 'all' | 'pending' | 'approved';

const FILTER_OPTIONS: Array<{ value: ApprovalFilter; label: string }> = [
  { value: 'pending', label: '未承認' },
  { value: 'approved', label: '承認済み' },
  { value: 'all', label: '全て' }
];

function formatDateTime(raw: string | null, timeOnly = false): string {
  if (!raw) return '—';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    ...(timeOnly ? {} : { month: '2-digit', day: '2-digit' }),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(new Date(raw));
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
      aria-current={selected ? 'true' : undefined}
      className={clsx(
        'grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-[#27313b] px-[14px] py-[10px] text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#7cc4ff]',
        selected ? 'bg-[#27313b]' : 'hover:bg-[#1b222a]'
      )}
    >
      <span className="truncate font-mono text-[21px] font-bold">{session.productNo}</span>
      <span className="self-center text-right font-mono text-[15px] text-[#9fadb9]">
        {formatDateTime(session.completedAt)}
      </span>
      <span className="truncate self-center text-[16px] text-[#9fadb9]">
        {session.targetUnit} · {session.operatorNameSnapshot}
      </span>
      <span
        className={clsx(
          'inline-flex h-[30px] items-center justify-self-end rounded-full border px-[10px] text-[16px] font-bold',
          approved ? 'border-[#3ba776] text-[#3ba776]' : 'border-[#f6b93b] text-[#f6b93b]'
        )}
      >
        {approved ? '承認済み' : '未承認'}
      </span>
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
  const checkSummary = resolveAssemblyCheckSummary(session);
  const checkItems = session.checkItems ?? [];
  const approvalClassName = 'inline-flex h-12 shrink-0 items-center gap-[10px] rounded-[10px] border border-[#3ba776] bg-[#3ba776]/10 pl-1.5 pr-[14px] text-[19px] font-black';
  const nfcSymbol = (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#3ba776] text-[#0b1a12]" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="2" width="16" height="20" rx="3" />
        <path d="M9 11a3 3 0 016 0M7 8a6 6 0 0110 0" />
      </svg>
    </span>
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-[14px] overflow-hidden px-5 py-4">
      <div className="flex shrink-0 flex-wrap items-center gap-[22px]">
        <h2 className="font-mono text-[34px] font-black">{session.productNo}</h2>
        <dl className="grid grid-cols-[auto_auto] gap-x-[10px] gap-y-0.5 text-[17px] [&_dt]:text-[#9fadb9] [&_dd]:font-mono [&_dd]:font-bold">
          <dt>機種</dt><dd>{session.targetUnit}</dd>
          <dt>作業者</dt><dd>{session.operatorNameSnapshot}</dd>
        </dl>
        <dl className="grid grid-cols-[auto_auto] gap-x-[10px] gap-y-0.5 text-[17px] [&_dt]:text-[#9fadb9] [&_dd]:font-mono [&_dd]:font-bold">
          <dt>完了</dt><dd>{formatDateTime(session.completedAt)}</dd>
          <dt>テンプレ</dt><dd>{session.template.name} v{session.template.version}</dd>
        </dl>
        <dl className="grid grid-cols-[auto_auto] gap-x-[10px] gap-y-0.5 text-[17px] [&_dt]:text-[#9fadb9] [&_dd]:font-mono [&_dd]:font-bold">
          <dt>締付</dt>
          <dd>{session.areaTorqueSummaries.reduce((sum, area) => sum + area.acceptedOkCount, 0)} / {session.areaTorqueSummaries.reduce((sum, area) => sum + area.totalBoltCount, 0)}</dd>
          <dt>必須チェック</dt><dd>{checkSummary.requiredCompleted} / {checkSummary.requiredTotal}</dd>
        </dl>
        <div className="ml-auto flex min-w-0 max-w-full items-center gap-3">
          {approved ? (
            <div className={approvalClassName} role="status" aria-label="承認状態">
              {nfcSymbol}
              <span>承認済み {session.approval?.approverEmployeeNameSnapshot} <span className="font-mono">{formatDateTime(session.approval?.approvedAt ?? null)}</span></span>
            </div>
          ) : (
            <button
              type="button"
              className={clsx(approvalClassName, 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7cc4ff] disabled:cursor-default')}
              disabled={!approver || approving}
              onClick={onApprove}
            >
              {nfcSymbol}
              <span>{approving ? '承認中…' : approver ? `承認: ${approver.displayName}で承認` : '承認: タグをかざす'}</span>
            </button>
          )}
          {!approved ? <p role="status" aria-label="承認者照合" className="max-h-11 max-w-[200px] overflow-hidden text-[17px] leading-5 text-[#f6b93b]">{statusMessage}</p> : null}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-[14px]">
        <section aria-labelledby="record-torque-heading" className="min-h-0 min-w-0 overflow-auto rounded-xl border border-[#27313b] bg-[#1b222a]">
          <h3 id="record-torque-heading" className="border-b border-[#27313b] px-[14px] py-[10px] text-[16px] tracking-widest text-[#9fadb9]">エリア別トルク実績</h3>
          <table aria-labelledby="record-torque-heading" className="w-full table-fixed text-left text-[18px]">
            <thead className="text-[16px] font-normal text-[#9fadb9]">
              <tr>
                <th scope="col" className="px-[14px] py-2 font-normal">エリア</th>
                <th scope="col" className="w-[110px] px-[14px] py-2 text-right font-normal">OK</th>
                <th scope="col" className="w-[110px] px-[14px] py-2 text-right font-normal">NG/無視</th>
              </tr>
            </thead>
            <tbody>
              {session.areaTorqueSummaries.map((area) => (
                <tr key={area.areaId} className="h-12 border-b border-[#27313b]">
                  <td className="truncate px-[14px]" title={`${area.processNo.trim() || '—'} · ${area.areaName.trim() || '—'}`}>{area.processNo.trim() || '—'} · {area.areaName.trim() || '—'}</td>
                  <td className={clsx('w-[110px] whitespace-nowrap px-[14px] text-right font-mono', area.acceptedOkCount === area.totalBoltCount ? 'text-[#3ba776]' : 'text-[#e5484d]')}>
                    {area.acceptedOkCount} / {area.totalBoltCount}
                  </td>
                  <td className="w-[110px] whitespace-nowrap px-[14px] text-right font-mono leading-5 text-[#9fadb9]">
                    <div className={area.ngCount > 0 ? 'text-[#e5484d]' : undefined}>NG {area.ngCount}</div>
                    <div className={area.ignoredCount > 0 ? 'text-[#e5484d]' : undefined}>無視 {area.ignoredCount}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section aria-labelledby="record-check-heading" className="min-h-0 min-w-0 overflow-auto rounded-xl border border-[#27313b] bg-[#1b222a]">
          <h3 id="record-check-heading" className="border-b border-[#27313b] px-[14px] py-[10px] text-[16px] tracking-widest text-[#9fadb9]">チェック実績</h3>
          <table aria-labelledby="record-check-heading" className="w-full table-fixed text-left text-[18px]">
            <thead className="sr-only">
              <tr><th>項目・必須</th><th>状態</th><th>時刻</th></tr>
            </thead>
            <tbody>
              {checkItems.map((item) => (
                <tr key={item.id} className="h-12 border-b border-[#27313b]">
                  <td className="truncate px-[14px]" title={item.label ?? `チェック${item.markerNo}`}><span className="font-mono">{item.markerNo}</span> {item.label ?? `チェック${item.markerNo}`}<span className="ml-2 text-[15px] text-[#9fadb9]">{item.required ? '必須' : '任意'}</span></td>
                  <td className={clsx('w-[110px] whitespace-nowrap px-[14px] text-right font-mono', item.record?.checked ? 'text-[#3ba776]' : 'text-[#e5484d]')}>
                    {item.record?.checked ? '済' : '未'}
                  </td>
                  <td className="w-[110px] whitespace-nowrap px-[14px] text-right font-mono text-[#9fadb9]">{formatDateTime(item.record?.checkedAt ?? null, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

export function KioskAssemblyRecordApprovalPage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const initialSessionId = searchParams.get('sessionId');
  const [accessGranted, setAccessGranted] = useState(false);
  const [accessDialogOpen, setAccessDialogOpen] = useState(true);
  const isActiveRoute = accessGranted && location.pathname.startsWith('/kiosk/assembly/record-approvals');
  const nfcEvent = useNfcStream(Boolean(isActiveRoute));
  const lastProcessedNfcKeyRef = useRef<string | null>(null);
  const [filter, setFilter] = useState<ApprovalFilter>(initialSessionId ? 'all' : 'pending');
  const [search, setSearch] = useState('');
  const [sessions, setSessions] = useState<AssemblyWorkSessionSummaryDto[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(initialSessionId);
  const [detail, setDetail] = useState<AssemblyWorkSessionDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [approver, setApprover] = useState<{ displayName: string; employeeId: string; nfcTagUid: string } | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  const reloadSessions = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const next = await listAssemblyWorkSessionSummaries({ status: 'completed', limit: 50 });
      setSessions(next);
    } catch {
      setListError('一覧の取得に失敗しました。');
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accessGranted) return;
    void reloadSessions();
  }, [accessGranted, reloadSessions]);

  const pendingCount = sessions.filter((session) => session.approval == null).length;
  const filteredSessions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ja-JP');
    return sessions.filter((session) => {
      if (filter === 'pending' && session.approval != null) return false;
      if (filter === 'approved' && session.approval == null) return false;
      return !query || [session.productNo, session.operatorNameSnapshot].some((value) => value.toLocaleLowerCase('ja-JP').includes(query));
    });
  }, [filter, search, sessions]);

  useEffect(() => {
    if (!accessGranted || listLoading) return;
    if (filteredSessions.length === 0) {
      setSelectedSessionId(null);
      return;
    }
    if (!selectedSessionId || !filteredSessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(filteredSessions[0].id);
    }
  }, [accessGranted, filteredSessions, listLoading, selectedSessionId]);

  useEffect(() => {
    if (!accessGranted || !selectedSessionId) {
      setDetail(null);
      setDetailLoading(false);
      setApprover(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void getAssemblyWorkSession(selectedSessionId)
      .then((session) => {
        if (!cancelled) {
          setDetail(session);
          setApprover(null);
          setStatusMessage(null);
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
    setApprover(null);
    setStatusMessage('照合中…');
    void resolveAssemblyOperatorNfc(nfcEvent.uid)
      .then((result) => {
        setApprover({
          employeeId: result.employeeId,
          displayName: result.displayName,
          nfcTagUid: nfcEvent.uid
        });
        setStatusMessage(`承認者: ${result.displayName}`);
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
      setStatusMessage(null);
      await reloadSessions();
    } catch (error: unknown) {
      setStatusMessage(readAssemblyApiErrorMessage(error, '承認処理に失敗しました。'));
    } finally {
      setApproving(false);
    }
  };

  if (!accessGranted) {
    return <div className="flex min-h-0 flex-1 bg-[#0f1317]">
      <div className="m-3 rounded border border-white/15 bg-slate-900/70 p-3 text-white">
        <h1 className="text-2xl font-bold">組立記録確認</h1>
        <p className="mt-1 text-sm text-white/65">組立記録確認にはパスワード認証が必要です。</p>
        <div className="mt-3 flex gap-2">
          <Button type="button" variant="secondary" onClick={() => setAccessDialogOpen(true)}>再認証</Button>
          <Link to={KIOSK_ASSEMBLY_HOME_PATH} className={buttonClassName('ghostOnDark', 'inline-flex items-center justify-center')}>組立へ戻る</Link>
        </div>
      </div>
      {accessDialogOpen ? <KioskPinDialog title="記録確認の暗証番号" onBack={() => setAccessDialogOpen(false)} onSubmit={async pin => {
        let result;
        try { result = await verifyKioskAssemblyRecordApprovalAccessPassword({ password: pin }); }
        catch (error) { return kioskPinErrorResult(error); }
        if (!result.success) return false;
        setAccessGranted(true);
        return true;
      }} /> : null}
    </div>;
  }

  const reloadButton = (
    <button
      type="button"
      aria-label="再読込"
      disabled={listLoading}
      onClick={() => void reloadSessions()}
      className="ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-[#344252] text-[#9fadb9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7cc4ff] disabled:opacity-50"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 7v5h-5M20 12a8 8 0 1 0-2 5M20 12l-4-4" />
      </svg>
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0f1317] text-[#eef3f6]">
      <div className="flex h-14 shrink-0 items-center gap-[14px] border-b border-[#27313b] bg-[#161c22] px-5">
        <h1 className="text-2xl font-black tracking-[.08em]">記録確認</h1>
        <Link to={KIOSK_ASSEMBLY_HOME_PATH} className="ml-auto inline-flex h-11 items-center rounded-lg px-4 text-[19px] font-bold text-[#9fadb9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7cc4ff]">
          組立へ戻る
        </Link>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[460px_minmax(0,1fr)]">
        <section aria-label="完了製品一覧" className="flex min-h-0 flex-col overflow-hidden border-r border-[#27313b] bg-[#161c22]">
          <div className="flex shrink-0 gap-1.5 px-[14px] pt-3">
            {FILTER_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={filter === option.value}
                onClick={() => setFilter(option.value)}
                className={clsx(
                  'h-11 rounded-full border border-[#344252] px-3 text-[17px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7cc4ff]',
                  filter === option.value ? 'bg-[#27313b] text-[#eef3f6]' : 'text-[#9fadb9]'
                )}
              >
                {option.label}{option.value === 'pending' ? ` ${pendingCount}` : ''}
              </button>
            ))}
            {reloadButton}
          </div>
          <div className="shrink-0 px-[14px] py-[10px]">
            <input
              type="search"
              aria-label="製番・作業者"
              placeholder="製番・作業者"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-11 w-full rounded-lg border border-[#344252] bg-white px-3 text-[19px] text-[#0f1317]"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {listError ? (
              <div className="flex items-center gap-3 px-[14px] py-3">
                <p role="alert" className="text-[17px] text-[#f6b93b]">{listError}</p>
                {reloadButton}
              </div>
            ) : null}
            {filteredSessions.length === 0 ? !listError && (
              <p className="px-[14px] py-6 text-center text-[17px] text-[#9fadb9]">
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
          <div className="flex min-h-0 items-center justify-center text-[17px] text-[#9fadb9]">
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
          <div className="flex min-h-0 flex-col items-center justify-center gap-3 text-[17px] text-[#9fadb9]">
            確認する完了製品を選択してください。
            {statusMessage ? <p role="status" className="text-[#f6b93b]">{statusMessage}</p> : null}
          </div>
        )}
      </div>
    </div>
  );
}
