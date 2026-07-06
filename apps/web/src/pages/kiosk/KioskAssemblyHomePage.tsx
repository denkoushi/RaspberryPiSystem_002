import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import {
  listAssemblySeibanCandidates,
  listAssemblyWorkSessionSummaries,
  startAssemblyWorkSession
} from '../../api/client';
import { buttonClassName } from '../../components/ui/Button';
import {
  AssemblyStartPane,
  AssemblyWipPane,
  KIOSK_ASSEMBLY_LIBRARY_PATH,
  kioskAssemblyProcedureOrderSettingsPath,
  kioskAssemblyWorkSessionPath,
  readAssemblyApiErrorMessage
} from '../../features/assembly';

import type { AssemblySeibanCandidateDto, AssemblyWorkSessionSummaryDto } from '../../features/assembly/types';

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

  const changeFseibanInput = (value: string) => {
    setFseibanInput(normalizeIdentifier(value));
  };

  const changeSerialNo = (value: string) => {
    setSerialNo(normalizeSerialIdentifier(value));
  };

  const backspaceFseiban = () => {
    setFseibanInput((current) => current.slice(0, -1));
  };

  const backspaceSerial = () => {
    setSerialNo((current) => current.slice(0, -1));
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
          <Link
            to={kioskAssemblyProcedureOrderSettingsPath({ machineName: selectedCandidate?.machineName ?? null })}
            className={buttonClassName('secondary', 'inline-flex min-h-11 items-center text-[1.02rem]')}
          >
            閲覧順設定
          </Link>
        </div>
      </div>

      {message ? <p className="rounded border border-white/15 bg-slate-900/80 px-3 py-2 text-sm font-semibold text-amber-200">{message}</p> : null}

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto xl:grid-cols-[minmax(0,1fr)_24rem] xl:overflow-hidden 2xl:grid-cols-[minmax(0,1fr)_24.5rem]">
        <AssemblyWipPane sessions={sessions} loading={sessionLoading} onReload={() => void reloadSessions()} />
        <AssemblyStartPane
          fseibanInput={fseibanInput}
          normalizedFseiban={normalizedFseiban}
          onFseibanInputChange={changeFseibanInput}
          onFseibanKey={appendFseiban}
          onFseibanBackspace={backspaceFseiban}
          onFseibanClear={() => setFseibanInput('')}
          candidates={candidates}
          candidateLoading={candidateLoading}
          selectedCandidate={selectedCandidate}
          onSelectCandidate={selectCandidate}
          serialNo={serialNo}
          onSerialNoChange={changeSerialNo}
          onSerialKey={appendSerial}
          onSerialBackspace={backspaceSerial}
          onSerialClear={() => setSerialNo('')}
          operatorNameSnapshot={operatorNameSnapshot}
          onOperatorNameChange={(value) => setOperatorNameSnapshot(value.slice(0, 120))}
          torqueWrenchId={torqueWrenchId}
          onTorqueWrenchIdChange={setTorqueWrenchId}
          canStart={canStart}
          busy={busy}
          onStart={() => void startWork()}
        />
      </main>
    </div>
  );
}
