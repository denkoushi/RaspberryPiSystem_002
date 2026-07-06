import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import {
  listAssemblySeibanCandidates,
  listAssemblyWorkSessionSummaries,
  startAssemblyWorkSession
} from '../../api/client';
import { Button, buttonClassName } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import {
  formatAssemblyTimestamp,
  KIOSK_ASSEMBLY_LIBRARY_PATH,
  kioskAssemblyWorkSessionPath,
  readAssemblyApiErrorMessage
} from '../../features/assembly';

import type { AssemblySeibanCandidateDto, AssemblyWorkSessionSummaryDto } from '../../features/assembly/types';

const SERIAL_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
const FSEIBAN_KEYS = SERIAL_KEYS;
const DEFAULT_TORQUE_WRENCH_ID = 'CEM20N3X10D-BTLA';

function toHalfWidthAscii(value: string): string {
  return value
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ');
}

function normalizeIdentifier(value: string): string {
  return toHalfWidthAscii(value).toUpperCase().replace(/[^A-Z0-9._/-]/g, '').slice(0, 120);
}

function normalizeSerialIdentifier(value: string): string {
  return toHalfWidthAscii(value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 120);
}

function progressText(session: AssemblyWorkSessionSummaryDto): string {
  if (session.totalBoltCount <= 0) return '0/0';
  return `${session.acceptedBoltCount}/${session.totalBoltCount}`;
}

export function KioskAssemblyHomePage() {
  const navigate = useNavigate();
  const [fseibanInput, setFseibanInput] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState<AssemblySeibanCandidateDto | null>(null);
  const [candidates, setCandidates] = useState<AssemblySeibanCandidateDto[]>([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [serialNo, setSerialNo] = useState('');
  const [operatorNameSnapshot, setOperatorNameSnapshot] = useState('');
  const [torqueWrenchId, setTorqueWrenchId] = useState(DEFAULT_TORQUE_WRENCH_ID);
  const [sessions, setSessions] = useState<AssemblyWorkSessionSummaryDto[]>([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const normalizedFseiban = useMemo(() => normalizeIdentifier(fseibanInput), [fseibanInput]);
  const normalizedSerialNo = useMemo(() => normalizeSerialIdentifier(serialNo), [serialNo]);
  const canStart =
    !!selectedCandidate?.activeTemplate &&
    normalizedSerialNo.length > 0 &&
    operatorNameSnapshot.trim().length > 0 &&
    torqueWrenchId.trim().length > 0;

  const reloadSessions = useCallback(async () => {
    setSessionLoading(true);
    try {
      setSessions(await listAssemblyWorkSessionSummaries({ status: 'in_progress', limit: 30 }));
    } catch (e: unknown) {
      setMessage(readAssemblyApiErrorMessage(e, '仕掛中の取得に失敗しました。'));
    } finally {
      setSessionLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadSessions();
  }, [reloadSessions]);

  useEffect(() => {
    setFseibanInput(normalizedFseiban);
  }, [normalizedFseiban]);

  useEffect(() => {
    setSerialNo(normalizedSerialNo);
  }, [normalizedSerialNo]);

  useEffect(() => {
    const prefix = normalizedFseiban.trim();
    setSelectedCandidate((current) => (current && current.fseiban === prefix ? current : null));
    if (prefix.length === 0) {
      setCandidates([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setCandidateLoading(true);
      void listAssemblySeibanCandidates({ prefix, limit: 20 })
        .then((next) => {
          if (cancelled) return;
          setCandidates(next);
        })
        .catch((e: unknown) => {
          if (!cancelled) setMessage(readAssemblyApiErrorMessage(e, '製番候補の取得に失敗しました。'));
        })
        .finally(() => {
          if (!cancelled) setCandidateLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [normalizedFseiban]);

  const appendFseiban = (key: string) => {
    setFseibanInput((current) => normalizeIdentifier(`${current}${key}`));
  };

  const appendSerial = (key: string) => {
    setSerialNo((current) => normalizeSerialIdentifier(`${current}${key}`));
  };

  const selectCandidate = (candidate: AssemblySeibanCandidateDto) => {
    setSelectedCandidate(candidate);
    setFseibanInput(candidate.fseiban);
    setMessage(null);
  };

  const startWork = async () => {
    if (!selectedCandidate?.activeTemplate) return;
    setBusy(true);
    setMessage(null);
    try {
      const session = await startAssemblyWorkSession({
        templateId: selectedCandidate.activeTemplate.id,
        productNo: selectedCandidate.fseiban,
        serialNo: normalizedSerialNo,
        operatorNameSnapshot: operatorNameSnapshot.trim(),
        targetUnit: selectedCandidate.machineName,
        torqueWrenchId: torqueWrenchId.trim()
      });
      navigate(kioskAssemblyWorkSessionPath(session.id));
    } catch (e: unknown) {
      setMessage(readAssemblyApiErrorMessage(e, '組立作業の開始に失敗しました。'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 bg-slate-800 p-2 text-white">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/15 bg-slate-900/70 p-2">
        <h1 className="text-[1.35rem] font-bold leading-tight">組立</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link to={KIOSK_ASSEMBLY_LIBRARY_PATH} className={buttonClassName('ghostOnDark', 'inline-flex min-h-11 items-center text-[1.02rem]')}>
            手順書ライブラリ
          </Link>
          <Link to={KIOSK_ASSEMBLY_LIBRARY_PATH} className={buttonClassName('primary', 'inline-flex min-h-11 items-center text-[1.02rem]')}>
            組立テンプレート
          </Link>
        </div>
      </div>

      {message ? <p className="rounded border border-white/15 bg-slate-900/80 px-3 py-2 text-sm font-semibold text-amber-200">{message}</p> : null}

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto xl:grid-cols-[minmax(28rem,0.9fr)_minmax(0,1.1fr)]">
        <section className="grid min-h-0 gap-2 rounded border border-white/15 bg-slate-950/45 p-2">
          <div className="grid gap-2">
            <label className="grid gap-1 text-sm font-semibold text-white/70">
              製番
              <Input
                value={fseibanInput}
                onChange={(event) => setFseibanInput(normalizeIdentifier(event.target.value))}
                placeholder="製番"
                className="min-h-12 text-[1.4rem] font-bold tracking-normal"
                disabled={busy}
              />
            </label>
            <div className="grid grid-cols-6 gap-1.5">
              {FSEIBAN_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  className="min-h-11 rounded border border-white/15 bg-slate-900 text-[1.05rem] font-bold text-white hover:bg-slate-700 disabled:opacity-50"
                  onClick={() => appendFseiban(key)}
                  disabled={busy}
                >
                  {key}
                </button>
              ))}
              <button
                type="button"
                className="min-h-11 rounded border border-white/15 bg-slate-900 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-50"
                onClick={() => setFseibanInput((current) => current.slice(0, -1))}
                disabled={busy}
              >
                BS
              </button>
              <button
                type="button"
                className="min-h-11 rounded border border-white/15 bg-slate-900 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-50"
                onClick={() => setFseibanInput('')}
                disabled={busy}
              >
                CLR
              </button>
            </div>
          </div>

          <div className="min-h-[9rem] rounded border border-white/10 bg-slate-900/70 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-[1.05rem] font-bold text-white/90">候補</h2>
              <span className="text-sm font-semibold text-white/55">{candidateLoading ? '検索中' : `${candidates.length}件`}</span>
            </div>
            {normalizedFseiban.length === 0 ? (
              <p className="text-sm font-semibold text-white/55">製番を入力</p>
            ) : candidates.length === 0 && !candidateLoading ? (
              <p className="text-sm font-semibold text-white/55">候補なし</p>
            ) : (
              <div className="grid max-h-[18rem] gap-1 overflow-y-auto pr-1">
                {candidates.map((candidate) => {
                  const selected = selectedCandidate?.fseiban === candidate.fseiban;
                  return (
                    <button
                      key={candidate.fseiban}
                      type="button"
                      className={`grid gap-1 rounded border px-3 py-2 text-left ${
                        selected ? 'border-cyan-300 bg-cyan-900/45' : 'border-white/10 bg-slate-950/55 hover:bg-slate-800'
                      }`}
                      onClick={() => selectCandidate(candidate)}
                      disabled={busy}
                    >
                      <span className="text-[1.08rem] font-bold text-white">{candidate.fseiban}</span>
                      <span className="text-sm font-semibold text-white/65">{candidate.machineName}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="grid min-h-0 gap-2 rounded border border-white/15 bg-slate-950/45 p-2">
          <div className="grid gap-2 rounded border border-white/10 bg-slate-900/65 p-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white/55">機種名</p>
                <p className="truncate text-[1.8rem] font-bold leading-tight text-white">
                  {selectedCandidate?.machineName ?? '未選択'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-white/55">テンプレート</p>
                <p className={`text-base font-bold ${selectedCandidate?.activeTemplate ? 'text-emerald-200' : 'text-amber-200'}`}>
                  {selectedCandidate ? (selectedCandidate.activeTemplate ? selectedCandidate.activeTemplate.name : 'テンプレート未登録') : '-'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_13rem]">
              <label className="grid gap-1 text-sm font-semibold text-white/70">
                シリアルNo.
                <Input
                  value={serialNo}
                  onChange={(event) => setSerialNo(normalizeSerialIdentifier(event.target.value))}
                  placeholder="シリアルNo."
                  className="min-h-12 text-[1.35rem] font-bold tracking-normal"
                  disabled={busy}
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-white/70">
                作業者
                <Input
                  value={operatorNameSnapshot}
                  onChange={(event) => setOperatorNameSnapshot(event.target.value.slice(0, 120))}
                  placeholder="作業者"
                  className="min-h-12"
                  disabled={busy}
                />
              </label>
            </div>

            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-9">
              {SERIAL_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  className="min-h-10 rounded border border-white/15 bg-slate-950 text-base font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                  onClick={() => appendSerial(key)}
                  disabled={busy}
                >
                  {key}
                </button>
              ))}
              <button
                type="button"
                className="min-h-10 rounded border border-white/15 bg-slate-950 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                onClick={() => setSerialNo((current) => current.slice(0, -1))}
                disabled={busy}
              >
                BS
              </button>
              <button
                type="button"
                className="min-h-10 rounded border border-white/15 bg-slate-950 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                onClick={() => setSerialNo('')}
                disabled={busy}
              >
                CLR
              </button>
            </div>

            <div className="flex flex-wrap items-end justify-between gap-2">
              <label className="grid min-w-[16rem] flex-1 gap-1 text-sm font-semibold text-white/70">
                トルクレンチ
                <Input value={torqueWrenchId} onChange={(event) => setTorqueWrenchId(event.target.value)} className="min-h-11" disabled={busy} />
              </label>
              {selectedCandidate && !selectedCandidate.activeTemplate ? (
                <Link to={KIOSK_ASSEMBLY_LIBRARY_PATH} className={buttonClassName('ghostOnDark', 'inline-flex min-h-12 items-center')}>
                  テンプレート登録
                </Link>
              ) : null}
              <Button type="button" variant="primary" className="min-h-12 min-w-[11rem] text-base" disabled={!canStart || busy} onClick={() => void startWork()}>
                {busy ? '開始中…' : '組立開始'}
              </Button>
            </div>
          </div>

          <div className="grid min-h-0 gap-2 rounded border border-white/10 bg-slate-900/65 p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[1.08rem] font-bold text-white/90">仕掛中</h2>
              <Button type="button" variant="ghostOnDark" className="min-h-9 !px-2 !py-0 text-sm" disabled={sessionLoading} onClick={() => void reloadSessions()}>
                {sessionLoading ? '更新中…' : '再読込'}
              </Button>
            </div>
            {sessions.length === 0 ? (
              <p className="rounded border border-white/10 bg-slate-950/45 px-3 py-4 text-sm font-semibold text-white/55">仕掛中なし</p>
            ) : (
              <div className="grid max-h-[22rem] gap-1.5 overflow-y-auto pr-1">
                {sessions.map((session) => (
                  <Link
                    key={session.id}
                    to={kioskAssemblyWorkSessionPath(session.id)}
                    className="grid gap-1 rounded border border-white/10 bg-slate-950/55 px-3 py-2 text-white hover:bg-slate-800 md:grid-cols-[9rem_minmax(0,1fr)_7rem_8rem]"
                  >
                    <span className="font-bold">{session.productNo}</span>
                    <span className="min-w-0 truncate font-semibold text-white/80">
                      {session.serialNo} / {session.targetUnit}
                    </span>
                    <span className="font-semibold text-cyan-200">{progressText(session)}</span>
                    <span className="text-sm font-semibold text-white/55">{formatAssemblyTimestamp(session.updatedAt)}</span>
                    <span className="min-w-0 truncate text-sm font-semibold text-white/60 md:col-span-4">
                      {session.currentAreaName ?? 'エリア完了'} {session.currentBoltMarkerNo ? `#${session.currentBoltMarkerNo}` : ''}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
