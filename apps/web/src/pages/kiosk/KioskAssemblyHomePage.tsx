import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import {
  createAssemblyLot,
  invalidateAssemblyWorkUnit,
  listAssemblyLotSummaries,
  listAssemblySeibanCandidates,
  listAssemblySeibanLotQuantities,
  listAssemblyWorkSessionSummaries,
  startAssemblyLotSerial
} from '../../api/client';
import {
  AssemblyHomeBoard,
  AssemblyLotRegisterRail,
  AssemblyOperatorNfcDialog,
  AssemblyWorkUnitInvalidationDialog,
  buildAssemblyLotWorkIds,
  createAssemblyRequestId,
  KIOSK_ASSEMBLY_TRAINING_PATH,
  kioskAssemblyLibraryPath,
  kioskAssemblyRecordApprovalPath,
  kioskAssemblyTraceabilityPath,
  kioskAssemblyWorkSessionPath,
  normalizeAssemblyUpperIdentifier,
  presentAssemblyHomeBoard,
  readAssemblyApiErrorMessage,
  toHalfWidthAscii
} from '../../features/assembly';

import type { AssemblyWorkUnitInvalidationTarget } from '../../features/assembly';
import type { AssemblyLotSummaryDto, AssemblySeibanCandidateDto, AssemblyWorkSessionSummaryDto } from '../../features/assembly/types';

const DEFAULT_TORQUE_WRENCH_ID = 'CEM20N3X10D-BTLA';
const MANUAL_LOT_QTY_MAX_DIGITS = 6;

function normalizeIdentifier(value: string): string {
  return toHalfWidthAscii(value).toUpperCase().replace(/[^A-Z0-9._/-]/g, '').slice(0, 120);
}

function normalizeSerialIdentifier(value: string): string {
  return normalizeIdentifier(value);
}

function normalizeManualLotQtyDraft(value: string): string {
  return toHalfWidthAscii(value).replace(/\D/g, '').slice(0, MANUAL_LOT_QTY_MAX_DIGITS);
}

function parsePositiveIntegerLotQty(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 500 ? parsed : null;
}

export function KioskAssemblyHomePage() {
  const navigate = useNavigate();
  const [fseibanInput, setFseibanInput] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState<AssemblySeibanCandidateDto | null>(null);
  const [candidates, setCandidates] = useState<AssemblySeibanCandidateDto[]>([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [serialDraft, setSerialDraft] = useState('');
  const [lotSerialNos, setLotSerialNos] = useState<string[]>([]);
  const [workIdMode, setWorkIdMode] = useState<'auto' | 'manual'>('auto');
  const [lots, setLots] = useState<AssemblyLotSummaryDto[]>([]);
  const [sessions, setSessions] = useState<AssemblyWorkSessionSummaryDto[]>([]);
  const [completedSessions, setCompletedSessions] = useState<AssemblyWorkSessionSummaryDto[]>([]);
  const [lotLoading, setLotLoading] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [completedLoading, setCompletedLoading] = useState(false);
  const [lotQtyByProductNo, setLotQtyByProductNo] = useState<Record<string, number>>({});
  const [lotQtyLoading, setLotQtyLoading] = useState(false);
  const [manualLotQtyDraft, setManualLotQtyDraft] = useState('');
  const [adjustedLotQty, setAdjustedLotQty] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [busySerialId, setBusySerialId] = useState<string | null>(null);
  const [pendingStart, setPendingStart] = useState<{ lotId: string; lotSerialId: string } | null>(null);
  const [operatorGateError, setOperatorGateError] = useState<string | null>(null);
  const [invalidationTarget, setInvalidationTarget] = useState<AssemblyWorkUnitInvalidationTarget | null>(null);
  const [invalidationBusy, setInvalidationBusy] = useState(false);
  const [invalidationError, setInvalidationError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const normalizedFseiban = useMemo(() => normalizeIdentifier(fseibanInput), [fseibanInput]);
  const normalizedSerialDraft = useMemo(() => normalizeSerialIdentifier(serialDraft), [serialDraft]);
  const selectedProductNoKey = selectedCandidate ? normalizeAssemblyUpperIdentifier(selectedCandidate.fseiban) : null;
  const selectedLotQty = selectedProductNoKey ? (lotQtyByProductNo[selectedProductNoKey] ?? null) : null;
  const boardRows = useMemo(
    () => presentAssemblyHomeBoard(lots, sessions, completedSessions),
    [lots, sessions, completedSessions]
  );
  const pendingApprovalCount = useMemo(
    () => completedSessions.filter((session) => session.approval == null).length,
    [completedSessions]
  );
  const autoLotQty =
    selectedLotQty != null && Number.isFinite(selectedLotQty) && Number.isInteger(selectedLotQty) && selectedLotQty > 0
      ? selectedLotQty
      : null;
  const manualLotQty = autoLotQty == null ? parsePositiveIntegerLotQty(manualLotQtyDraft) : null;
  const expectedLotQuantity = autoLotQty != null ? (adjustedLotQty ?? autoLotQty) : (manualLotQty ?? null);
  const autoWorkIds = useMemo(() => {
    if (!selectedCandidate || expectedLotQuantity == null) return [];
    try {
      return buildAssemblyLotWorkIds(selectedCandidate.fseiban, expectedLotQuantity);
    } catch {
      return [];
    }
  }, [expectedLotQuantity, selectedCandidate]);
  const registrationWorkIds = workIdMode === 'auto' ? autoWorkIds : lotSerialNos;
  const serialDraftDuplicate = normalizedSerialDraft.length > 0 && registrationWorkIds.includes(normalizedSerialDraft);
  const canRegisterLot =
    !!selectedCandidate?.activeTemplate &&
    expectedLotQuantity != null &&
    registrationWorkIds.length === expectedLotQuantity;

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

  const boardLoading = lotLoading || sessionLoading || completedLoading;
  const reloadBoard = useCallback(() => {
    void reloadLots();
    void reloadSessions();
    void reloadCompletedSessions();
  }, [reloadLots, reloadSessions, reloadCompletedSessions]);

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
    setWorkIdMode('auto');
    setManualLotQtyDraft('');
    setAdjustedLotQty(null);
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
    setWorkIdMode('auto');
    setManualLotQtyDraft('');
    setAdjustedLotQty(null);
    setMessage(null);
  };

  const changeManualLotQtyDraft = (value: string) => {
    setManualLotQtyDraft(normalizeManualLotQtyDraft(value));
  };

  const adjustLotQty = (delta: -1 | 1) => {
    if (autoLotQty == null) return;
    setAdjustedLotQty((current) => Math.min(500, Math.max(1, (current ?? autoLotQty) + delta)));
    setMessage(null);
  };

  const changeWorkIdMode = (mode: 'auto' | 'manual') => {
    if (mode === 'manual') {
      setLotSerialNos(autoWorkIds);
    }
    setWorkIdMode(mode);
    setSerialDraft('');
    setMessage(null);
  };

  const addSerialToLot = () => {
    const next = normalizedSerialDraft;
    if (!next) return;
    if (expectedLotQuantity == null) {
      setMessage(
        lotQtyLoading
          ? 'ロット数を取得中です。'
          : 'ロット数を取得できません。台数を手入力してください。'
      );
      return;
    }
    if (registrationWorkIds.length >= expectedLotQuantity) {
      setMessage('ロット数を超える作業用IDは登録できません。');
      return;
    }
    if (registrationWorkIds.includes(next)) {
      setMessage('同じ作業用IDは登録できません。');
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
          ? 'ロット数を取得中です。'
          : 'ロット数を取得できません。台数を手入力してください。'
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
        workIdMode,
        ...(workIdMode === 'manual' ? { workIds: registrationWorkIds } : {}),
        targetUnit: selectedCandidate.machineName,
        ...(selectedCandidate.activeTemplate.traceabilityMode !== 'REQUIRED'
          ? { torqueWrenchId: DEFAULT_TORQUE_WRENCH_ID }
          : {})
      });
      setLotSerialNos([]);
      setWorkIdMode('auto');
      setSerialDraft('');
      setMessage('ロットを登録しました。');
      await reloadLots();
    } catch (e: unknown) {
      setMessage(readAssemblyApiErrorMessage(e, 'ロット登録に失敗しました。'));
    } finally {
      setBusy(false);
    }
  };

  const openStartNfcGate = (lotId: string, lotSerialId: string) => {
    setPendingStart({ lotId, lotSerialId });
    setOperatorGateError(null);
  };

  const startRegisteredSerial = async (operatorNfcTagUid: string) => {
    if (!pendingStart) return;
    const requestId = createAssemblyRequestId();
    setBusySerialId(pendingStart.lotSerialId);
    setOperatorGateError(null);
    try {
      const session = await startAssemblyLotSerial(pendingStart.lotId, pendingStart.lotSerialId, {
        operatorNfcTagUid,
        requestId
      });
      setPendingStart(null);
      navigate(kioskAssemblyWorkSessionPath(session.id), {
        state: { assemblyOperatorAccessGrant: { sessionId: session.id, requestId } }
      });
    } catch (e: unknown) {
      setOperatorGateError(readAssemblyApiErrorMessage(e, '社員タグを確認できませんでした。'));
    } finally {
      setBusySerialId(null);
    }
  };

  const confirmInvalidation = async (input: { accessPassword: string; reason: string }) => {
    if (!invalidationTarget) return;
    setInvalidationBusy(true);
    setInvalidationError(null);
    try {
      await invalidateAssemblyWorkUnit(invalidationTarget.workUnitId, {
        ...input,
        requestId: createAssemblyRequestId()
      });
      setInvalidationTarget(null);
      setMessage('削除しました。履歴は残ります。');
      await Promise.all([reloadLots(), reloadSessions(), reloadCompletedSessions()]);
    } catch (error: unknown) {
      setInvalidationError(readAssemblyApiErrorMessage(error, '作業アイテムを削除できませんでした。'));
    } finally {
      setInvalidationBusy(false);
    }
  };

  const openInvalidation = (target: AssemblyWorkUnitInvalidationTarget) => {
    setInvalidationTarget(target);
    setInvalidationError(null);
  };
  const navLinkClassName =
    'inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-bold text-[#9fadb9] hover:bg-[#1f2730] hover:text-[#eef3f6]';

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#0f1317] text-[#eef3f6]">
      <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#27313b] bg-[#161c22] px-3.5">
        <h1 className="text-lg font-black tracking-widest">組立</h1>
        <nav className="flex flex-wrap items-center gap-1" aria-label="組立メニュー">
          <Link to="/kiosk/assembly/manuals" className={navLinkClassName}>要領書</Link>
          <Link to={KIOSK_ASSEMBLY_TRAINING_PATH} className={navLinkClassName}>
            訓練
          </Link>
          <Link to={kioskAssemblyLibraryPath({ focus: 'procedures' })} className={navLinkClassName}>
            手順書
          </Link>
          <Link to={kioskAssemblyLibraryPath({ focus: 'templates' })} className={navLinkClassName}>
            手順を作る
          </Link>
          <Link to={kioskAssemblyRecordApprovalPath()} className={navLinkClassName} aria-label="記録確認">
            記録確認
            {pendingApprovalCount > 0 ? (
              <span className="rounded-full bg-[#ff7d61] px-1.5 font-mono text-xs font-semibold text-[#2a0a02]" aria-hidden="true">
                {pendingApprovalCount}
              </span>
            ) : null}
          </Link>
          <Link to={kioskAssemblyTraceabilityPath()} className={navLinkClassName}>
            製品構成
          </Link>
        </nav>
      </div>

      {message ? (
        <p role="status" className="shrink-0 border-b border-[#27313b] bg-[#161c22] px-3.5 py-1.5 text-sm font-bold text-[#f6b93b]">
          {message}
        </p>
      ) : null}

      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-auto xl:grid-cols-[minmax(0,1fr)_22rem] xl:overflow-hidden">
        <AssemblyHomeBoard
          rows={boardRows}
          loading={boardLoading}
          busySerialId={busySerialId}
          onReload={reloadBoard}
          onStartSerial={openStartNfcGate}
          onInvalidate={openInvalidation}
        />
        <AssemblyLotRegisterRail
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
          workIdMode={workIdMode}
          onWorkIdModeChange={changeWorkIdMode}
          serialDraft={serialDraft}
          serialNos={registrationWorkIds}
          expectedLotQuantity={expectedLotQuantity}
          serialDraftDuplicate={serialDraftDuplicate}
          onSerialDraftChange={changeSerialDraft}
          onSerialKey={appendSerial}
          onSerialBackspace={backspaceSerial}
          onSerialClear={() => setSerialDraft('')}
          onSerialAdd={addSerialToLot}
          onSerialRemove={removeSerialFromLot}
          autoLotQty={autoLotQty}
          onAdjustLotQty={adjustLotQty}
          manualLotQtyDraft={manualLotQtyDraft}
          onManualLotQtyDraftChange={changeManualLotQtyDraft}
          lotQtyLoading={lotQtyLoading}
          canRegisterLot={canRegisterLot}
          busy={busy}
          onRegisterLot={() => void registerLot()}
        />
      </main>
      <AssemblyOperatorNfcDialog
        open={pendingStart != null}
        title="作業者確認"
        description="作業開始前に、実際に作業する社員のNFCタグをスキャンしてください。"
        busy={busySerialId != null}
        error={operatorGateError}
        onScan={(uid) => void startRegisteredSerial(uid)}
        onCancel={() => {
          setPendingStart(null);
          setOperatorGateError(null);
        }}
      />
      <AssemblyWorkUnitInvalidationDialog
        target={invalidationTarget}
        busy={invalidationBusy}
        error={invalidationError}
        onConfirm={(input) => void confirmInvalidation(input)}
        onCancel={() => {
          setInvalidationTarget(null);
          setInvalidationError(null);
        }}
      />
    </div>
  );
}
