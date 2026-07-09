import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useMatch, useNavigate } from 'react-router-dom';

import {
  createAssemblyLot,
  listAssemblyLotSummaries,
  listAssemblySeibanCandidates,
  listAssemblySeibanLotQuantities,
  listAssemblyWorkSessionSummaries,
  resolveAssemblyOperatorNfc,
  startAssemblyLotSerial
} from '../../api/client';
import { buttonClassName } from '../../components/ui/Button';
import {
  AssemblyCompletedPane,
  AssemblyLotPane,
  AssemblyStartPane,
  AssemblyWipPane,
  kioskAssemblyLibraryPath,
  kioskAssemblyProcedureOrderSettingsPath,
  kioskAssemblyRecordApprovalPath,
  kioskAssemblyWorkSessionPath,
  normalizeAssemblyUpperIdentifier,
  readAssemblyApiErrorMessage,
  toHalfWidthAscii
} from '../../features/assembly';
import { useNfcStream } from '../../hooks/useNfcStream';

import type { AssemblyLotSummaryDto, AssemblySeibanCandidateDto, AssemblyWorkSessionSummaryDto } from '../../features/assembly/types';

const DEFAULT_TORQUE_WRENCH_ID = 'CEM20N3X10D-BTLA';
const MANUAL_LOT_QTY_MAX_DIGITS = 6;

function normalizeIdentifier(value: string): string {
  return toHalfWidthAscii(value).toUpperCase().replace(/[^A-Z0-9._/-]/g, '').slice(0, 120);
}

function normalizeSerialIdentifier(value: string): string {
  return toHalfWidthAscii(value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 120);
}

function normalizeManualLotQtyDraft(value: string): string {
  return toHalfWidthAscii(value).replace(/\D/g, '').slice(0, MANUAL_LOT_QTY_MAX_DIGITS);
}

function parsePositiveIntegerLotQty(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function KioskAssemblyHomePage() {
  const navigate = useNavigate();
  const isActiveRoute = useMatch('/kiosk/assembly');
  const nfcEvent = useNfcStream(Boolean(isActiveRoute));
  const lastNfcKeyRef = useRef<string | null>(null);
  const [fseibanInput, setFseibanInput] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState<AssemblySeibanCandidateDto | null>(null);
  const [candidates, setCandidates] = useState<AssemblySeibanCandidateDto[]>([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [serialDraft, setSerialDraft] = useState('');
  const [lotSerialNos, setLotSerialNos] = useState<string[]>([]);
  const [operatorNameSnapshot, setOperatorNameSnapshot] = useState('');
  const [operatorEmployeeId, setOperatorEmployeeId] = useState<string | null>(null);
  const [torqueWrenchId, setTorqueWrenchId] = useState(DEFAULT_TORQUE_WRENCH_ID);
  const [lots, setLots] = useState<AssemblyLotSummaryDto[]>([]);
  const [sessions, setSessions] = useState<AssemblyWorkSessionSummaryDto[]>([]);
  const [completedSessions, setCompletedSessions] = useState<AssemblyWorkSessionSummaryDto[]>([]);
  const [lotLoading, setLotLoading] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [completedLoading, setCompletedLoading] = useState(false);
  const [lotQtyByProductNo, setLotQtyByProductNo] = useState<Record<string, number>>({});
  const [lotQtyLoading, setLotQtyLoading] = useState(false);
  const [manualLotQtyDraft, setManualLotQtyDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [busySerialId, setBusySerialId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const normalizedFseiban = useMemo(() => normalizeIdentifier(fseibanInput), [fseibanInput]);
  const normalizedSerialDraft = useMemo(() => normalizeSerialIdentifier(serialDraft), [serialDraft]);
  const selectedProductNoKey = selectedCandidate ? normalizeAssemblyUpperIdentifier(selectedCandidate.fseiban) : null;
  const selectedLotQty = selectedProductNoKey ? (lotQtyByProductNo[selectedProductNoKey] ?? null) : null;
  const autoLotQty =
    selectedLotQty != null && Number.isFinite(selectedLotQty) && Number.isInteger(selectedLotQty) && selectedLotQty > 0
      ? selectedLotQty
      : null;
  const manualLotQty = autoLotQty == null ? parsePositiveIntegerLotQty(manualLotQtyDraft) : null;
  const expectedLotQuantity = autoLotQty ?? manualLotQty ?? null;
  const serialDraftDuplicate = normalizedSerialDraft.length > 0 && lotSerialNos.includes(normalizedSerialDraft);
  const canRegisterLot =
    !!selectedCandidate?.activeTemplate &&
    expectedLotQuantity != null &&
    lotSerialNos.length === expectedLotQuantity &&
    operatorNameSnapshot.trim().length > 0 &&
    torqueWrenchId.trim().length > 0;

  const productNosForLotQty = useMemo(() => {
    const productNos = new Set<string>();
    for (const lot of lots) productNos.add(lot.productNo);
    for (const session of sessions) productNos.add(session.productNo);
    for (const session of completedSessions) productNos.add(session.productNo);
    if (selectedCandidate) productNos.add(selectedCandidate.fseiban);
    return [...productNos];
  }, [lots, sessions, completedSessions, selectedCandidate]);

  const reloadLots = useCallback(async () => {
    setLotLoading(true);
    try {
      setLots(await listAssemblyLotSummaries({ limit: 30 }));
    } catch (e: unknown) {
      setMessage(readAssemblyApiErrorMessage(e, '登録済みロットの取得に失敗しました。'));
    } finally {
      setLotLoading(false);
    }
  }, []);

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

  const reloadCompletedSessions = useCallback(async () => {
    setCompletedLoading(true);
    try {
      setCompletedSessions(await listAssemblyWorkSessionSummaries({ status: 'completed', limit: 30 }));
    } catch (e: unknown) {
      setMessage(readAssemblyApiErrorMessage(e, '完了した製品の取得に失敗しました。'));
    } finally {
      setCompletedLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadLots();
    void reloadSessions();
    void reloadCompletedSessions();
  }, [reloadLots, reloadSessions, reloadCompletedSessions]);

  useEffect(() => {
    if (productNosForLotQty.length === 0) {
      setLotQtyByProductNo({});
      setLotQtyLoading(false);
      return;
    }

    let cancelled = false;
    setLotQtyLoading(true);
    void listAssemblySeibanLotQuantities(productNosForLotQty)
      .then((items) => {
        if (cancelled) return;
        const next: Record<string, number> = {};
        for (const item of items) {
          next[normalizeAssemblyUpperIdentifier(item.productNo)] = item.lotQty;
        }
        setLotQtyByProductNo(next);
      })
      .catch(() => {
        if (!cancelled) setLotQtyByProductNo({});
      })
      .finally(() => {
        if (!cancelled) setLotQtyLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [productNosForLotQty]);

  useEffect(() => {
    setFseibanInput(normalizedFseiban);
  }, [normalizedFseiban]);

  useEffect(() => {
    setSerialDraft(normalizedSerialDraft);
  }, [normalizedSerialDraft]);

  useEffect(() => {
    if (selectedCandidate) return;
    setSerialDraft('');
    setLotSerialNos([]);
    setManualLotQtyDraft('');
  }, [selectedCandidate]);

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

  useEffect(() => {
    if (!nfcEvent || busy) return;
    const key = `${nfcEvent.uid}:${nfcEvent.timestamp}`;
    if (lastNfcKeyRef.current === key) return;
    lastNfcKeyRef.current = key;
    void (async () => {
      try {
        const resolved = await resolveAssemblyOperatorNfc(nfcEvent.uid);
        setOperatorNameSnapshot(resolved.displayName);
        setOperatorEmployeeId(resolved.employeeId);
        setMessage(null);
      } catch (e: unknown) {
        setMessage(readAssemblyApiErrorMessage(e, '社員タグの解決に失敗しました。'));
      }
    })();
  }, [nfcEvent, busy]);

  const appendFseiban = (key: string) => {
    setFseibanInput((current) => normalizeIdentifier(`${current}${key}`));
  };

  const appendSerial = (key: string) => {
    setSerialDraft((current) => normalizeSerialIdentifier(`${current}${key}`));
  };

  const changeFseibanInput = (value: string) => {
    setFseibanInput(normalizeIdentifier(value));
  };

  const changeSerialDraft = (value: string) => {
    setSerialDraft(normalizeSerialIdentifier(value));
  };

  const backspaceFseiban = () => {
    setFseibanInput((current) => current.slice(0, -1));
  };

  const backspaceSerial = () => {
    setSerialDraft((current) => current.slice(0, -1));
  };

  const selectCandidate = (candidate: AssemblySeibanCandidateDto) => {
    setSelectedCandidate(candidate);
    setFseibanInput(candidate.fseiban);
    setSerialDraft('');
    setLotSerialNos([]);
    setManualLotQtyDraft('');
    setMessage(null);
  };

  const changeManualLotQtyDraft = (value: string) => {
    setManualLotQtyDraft(normalizeManualLotQtyDraft(value));
  };

  const changeOperatorName = (value: string) => {
    setOperatorNameSnapshot(value.slice(0, 120));
    setOperatorEmployeeId(null);
  };

  const addSerialToLot = () => {
    const next = normalizedSerialDraft;
    if (!next) return;
    if (expectedLotQuantity == null) {
      setMessage(
        lotQtyLoading
          ? 'ロット数を取得中です。しばらくお待ちください。'
          : '生産実績からロット数を取得できませんでした。ロット数を手入力してください。'
      );
      return;
    }
    if (lotSerialNos.length >= expectedLotQuantity) {
      setMessage('ロット数を超えるシリアルNo.は登録できません。');
      return;
    }
    if (lotSerialNos.includes(next)) {
      setMessage('同じシリアルNo.は登録できません。');
      return;
    }
    setLotSerialNos((current) => [...current, next]);
    setSerialDraft('');
    setMessage(null);
  };

  const removeSerialFromLot = (serialNo: string) => {
    setLotSerialNos((current) => current.filter((item) => item !== serialNo));
  };

  const registerLot = async () => {
    if (!selectedCandidate?.activeTemplate) return;
    if (expectedLotQuantity == null) {
      setMessage(
        lotQtyLoading
          ? 'ロット数を取得中です。しばらくお待ちください。'
          : '生産実績からロット数を取得できませんでした。ロット数を手入力してください。'
      );
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await createAssemblyLot({
        templateId: selectedCandidate.activeTemplate.id,
        productNo: selectedCandidate.fseiban,
        expectedQuantity: expectedLotQuantity,
        serialNos: lotSerialNos,
        operatorEmployeeId,
        operatorNameSnapshot: operatorNameSnapshot.trim(),
        targetUnit: selectedCandidate.machineName,
        torqueWrenchId: torqueWrenchId.trim()
      });
      setLotSerialNos([]);
      setSerialDraft('');
      setMessage('ロットを登録しました。登録済みロットからシリアルごとに開始してください。');
      await reloadLots();
    } catch (e: unknown) {
      setMessage(readAssemblyApiErrorMessage(e, 'ロット登録に失敗しました。'));
    } finally {
      setBusy(false);
    }
  };

  const startRegisteredSerial = async (lotId: string, lotSerialId: string) => {
    setBusySerialId(lotSerialId);
    setMessage(null);
    try {
      const session = await startAssemblyLotSerial(lotId, lotSerialId);
      navigate(kioskAssemblyWorkSessionPath(session.id));
    } catch (e: unknown) {
      setMessage(readAssemblyApiErrorMessage(e, 'シリアルの組立開始に失敗しました。'));
    } finally {
      setBusySerialId(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 bg-slate-800 p-2 text-white">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/15 bg-slate-900/70 p-2">
        <h1 className="text-[1.35rem] font-bold leading-tight">組立</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={kioskAssemblyLibraryPath({ focus: 'procedures' })}
            className={buttonClassName('ghostOnDark', 'inline-flex min-h-11 items-center text-[1.02rem]')}
          >
            手順書ライブラリ
          </Link>
          <Link
            to={kioskAssemblyLibraryPath({ focus: 'templates' })}
            className={buttonClassName('ghostOnDark', 'inline-flex min-h-11 items-center text-[1.02rem]')}
          >
            組立テンプレート
          </Link>
          <Link
            to={kioskAssemblyProcedureOrderSettingsPath({ machineName: selectedCandidate?.machineName ?? null })}
            className={buttonClassName('ghostOnDark', 'inline-flex min-h-11 items-center text-[1.02rem]')}
          >
            閲覧順設定
          </Link>
          <Link
            to={kioskAssemblyRecordApprovalPath()}
            className={buttonClassName('ghostOnDark', 'inline-flex min-h-11 items-center text-[1.02rem]')}
          >
            記録確認
          </Link>
        </div>
      </div>

      {message ? <p className="rounded border border-white/15 bg-slate-900/80 px-3 py-2 text-sm font-semibold text-amber-200">{message}</p> : null}

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto xl:grid-cols-[minmax(0,1fr)_24rem] xl:overflow-hidden 2xl:grid-cols-[minmax(0,1fr)_24.5rem]">
        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-2 xl:grid-cols-3 xl:overflow-hidden">
          <AssemblyLotPane
            lots={lots}
            loading={lotLoading}
            busySerialId={busySerialId}
            onReload={() => void reloadLots()}
            onStartSerial={(lotId, lotSerialId) => void startRegisteredSerial(lotId, lotSerialId)}
          />
          <AssemblyWipPane sessions={sessions} loading={sessionLoading} onReload={() => void reloadSessions()} />
          <AssemblyCompletedPane
            sessions={completedSessions}
            loading={completedLoading}
            onReload={() => void reloadCompletedSessions()}
            lotQtyByProductNo={lotQtyByProductNo}
          />
        </div>
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
          serialDraft={serialDraft}
          serialNos={lotSerialNos}
          expectedLotQuantity={expectedLotQuantity}
          serialDraftDuplicate={serialDraftDuplicate}
          onSerialDraftChange={changeSerialDraft}
          onSerialKey={appendSerial}
          onSerialBackspace={backspaceSerial}
          onSerialClear={() => setSerialDraft('')}
          onSerialAdd={addSerialToLot}
          onSerialRemove={removeSerialFromLot}
          operatorNameSnapshot={operatorNameSnapshot}
          onOperatorNameChange={changeOperatorName}
          selectedLotQty={selectedLotQty}
          autoLotQty={autoLotQty}
          manualLotQtyDraft={manualLotQtyDraft}
          onManualLotQtyDraftChange={changeManualLotQtyDraft}
          lotQtyLoading={lotQtyLoading}
          torqueWrenchId={torqueWrenchId}
          onTorqueWrenchIdChange={setTorqueWrenchId}
          canRegisterLot={canRegisterLot}
          busy={busy}
          onRegisterLot={() => void registerLot()}
        />
      </main>
    </div>
  );
}
