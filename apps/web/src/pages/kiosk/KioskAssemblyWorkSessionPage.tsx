import { Link } from 'react-router-dom';

import {
  advanceAssemblyArea,
  completeAssemblyWorkSession,
  recordAssemblyOperatorAccess,
  recordAssemblyCheck,
  recordAssemblyTorque,
  restartAssemblyArea
} from '../../api/client';
import { buttonClassName } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import {
  AssemblyBoltConditionPreparationCard,
  AssemblyOperatorNfcDialog,
  AssemblyWorkSessionHeader,
  createAssemblyRequestId,
  KIOSK_ASSEMBLY_HOME_PATH,
  readAssemblyApiErrorMessage,
  resolveAssemblyWorkActionPresentation,
  TorqueResultHistoryRow
} from '../../features/assembly';
import { kioskFlowButtonClass } from '../../features/kiosk/kioskFlowButtonTheme';
import {
  TorqueWrenchTakeoverPanel,
  resolveTorqueWrenchConnectionPresentation
} from '../../features/torque-wrench-connection';

import { AssemblyWorkSessionGuidePanel } from './assemblyWorkSession/AssemblyWorkSessionGuidePanel';
import { AssemblyWorkSessionProcedurePane } from './assemblyWorkSession/AssemblyWorkSessionProcedurePane';
import { useAssemblyWorkSessionState } from './assemblyWorkSession/useAssemblyWorkSessionState';

export function KioskAssemblyWorkSessionPage() {
  const {
    navigate,
    session,
    setSession,
    setAuthorizedSessionId,
    operatorGateBusy,
    setOperatorGateBusy,
    operatorGateError,
    setOperatorGateError,
    torqueValue,
    setTorqueValue,
    torqueSource,
    setTorqueSource,
    loading,
    busy,
    setBusy,
    restartConfirmOpen,
    setRestartConfirmOpen,
    message,
    setMessage,
    hermesGuideBusy,
    operatorAuthorized,
    sessionActive,
    traceabilityRequired,
    compatibleWrenches,
    selectedProfileId,
    setSelectedProfileId,
    selectedCompatibleWrench,
    confirmation,
    confirmationReused,
    confirmationLookupState,
    connectionRetryRequired,
    preparationBusy,
    boltConditionOnly,
    confirmPhysicalWrench,
    connectBoltConditionWrench,
    resetAfterRelease,
    torqueConnection,
    procedureSequenceState,
    retryProcedureSequence,
    checkSummary,
    currentArea,
    currentBolt,
    allBoltsComplete,
    canComplete,
    displayedHermesGuide,
    requestHermesGuide,
    visibleBoltMarkers,
    visibleCheckMarkers,
    completeDisabledReason,
    handleCurrentPageChange
  } = useAssemblyWorkSessionState();

  const runBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (e: unknown) {
      setMessage(readAssemblyApiErrorMessage(e, '処理に失敗しました。'));
    } finally {
      setBusy(false);
    }
  };

  const recordTorque = () =>
    runBusy(async () => {
      if (!session) throw new Error('作業を開始してください。');
      const value = Number(torqueValue);
      if (!Number.isFinite(value)) throw new Error('トルク値を入力してください。');
      const result = await recordAssemblyTorque(session.id, { value, source: torqueSource });
      setSession(result.session);
      setTorqueValue('');
      if (result.outcome.kind === 'ignored_duplicate') setMessage('1秒以内の再送信として無視しました。');
      else if (result.outcome.kind === 'recorded_ng') {
        setMessage(result.outcome.requiresAreaRestart ? 'NGです。上限超過が続いています。エリアやり直しを確認してください。' : 'NGです。同じ箇所で停止します。');
      } else {
        setMessage(result.outcome.areaCompleted ? 'エリア完了です。次工程へ進んでください。' : 'OKです。次の締付箇所へ進みました。');
      }
    });

  const startUsingWrench = () =>
    runBusy(async () => {
      if (!session?.currentBoltId || !confirmation) throw new Error('先に現物確認を完了してください。');
      await torqueConnection.acquire(globalThis.crypto?.randomUUID?.() ?? `lease-${Date.now()}`);
    });

  const takeoverWrench = () =>
    runBusy(async () => {
      if (!session?.currentBoltId || !confirmation) throw new Error('先に現物確認を完了してください。');
      await torqueConnection.takeover('作業者が現物を手元で二段階確認');
    });

  const stopUsingWrench = async (reason = 'OPERATOR_RELEASE') => {
    const released = await torqueConnection.release(reason);
    if (released) resetAfterRelease();
  };

  const toggleCheckItem = (checkItemId: string) =>
    runBusy(async () => {
      if (!session) return;
      const item = session.checkItems?.find((candidate) => candidate.id === checkItemId);
      const nextChecked = !(item?.record?.checked ?? false);
      const result = await recordAssemblyCheck(session.id, { checkItemId, checked: nextChecked });
      setSession((prev) =>
        prev
          ? {
              ...prev,
              checkSummary: result.checkSummary,
              checkItems: (prev.checkItems ?? []).map((candidate) =>
                candidate.id === checkItemId ? { ...candidate, record: result.record } : candidate
              )
            }
          : prev
      );
    });

  const completeSession = () =>
    runBusy(async () => {
      if (!session) return;
      await stopUsingWrench('WORK_SESSION_COMPLETED');
      const updated = await completeAssemblyWorkSession(session.id);
      setSession(updated);
      setMessage('作業を完了しました。');
    });

  const resumeWithOperatorNfc = async (operatorNfcTagUid: string) => {
    if (!session) return;
    setOperatorGateBusy(true);
    setOperatorGateError(null);
    try {
      const requestId = createAssemblyRequestId();
      const updated = await recordAssemblyOperatorAccess(session.id, {
        operatorNfcTagUid,
        requestId
      });
      setSession(updated);
      setAuthorizedSessionId(updated.id);
    } catch (error: unknown) {
      setOperatorGateError(readAssemblyApiErrorMessage(error, '社員タグを確認できませんでした。'));
    } finally {
      setOperatorGateBusy(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-800 text-white">読込中…</div>;
  }

  if (!session) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 bg-slate-800 p-2 text-white">
        <Link to={KIOSK_ASSEMBLY_HOME_PATH} className={buttonClassName('ghostOnDark', 'inline-flex min-h-11 w-fit items-center')}>
          組立へ戻る
        </Link>
        <p className="rounded border border-white/15 bg-slate-900/80 px-3 py-2 text-sm font-semibold text-amber-200">
          {message ?? '作業データが見つかりません。'}
        </p>
      </div>
    );
  }

  if (session.status === 'in_progress' && !operatorAuthorized) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 bg-slate-800 p-2 text-white">
        <AssemblyWorkSessionHeader
          productNo={session.productNo}
          modelCode={session.template.modelCode}
          procedurePattern={session.template.procedurePattern}
          procedureModeLabel="作業"
          currentPositionLabel="作業者確認待ち"
          requiredCheckLabel={null}
        />
        <div className="flex min-h-0 flex-1 items-center justify-center rounded border border-white/15 bg-slate-900/70">
          <p className="text-base font-bold text-cyan-100">NFC確認後に手順書と作業機器を開始します。</p>
        </div>
        <AssemblyOperatorNfcDialog
          open
          title="作業者確認"
          description="仕掛作業を再開する社員のNFCタグをスキャンしてください。再読込・直開きのたびに確認が必要です。"
          busy={operatorGateBusy}
          error={operatorGateError}
          onScan={(uid) => void resumeWithOperatorNfc(uid)}
          onCancel={() => navigate(KIOSK_ASSEMBLY_HOME_PATH)}
        />
      </div>
    );
  }

  const currentPositionLabel =
    procedureSequenceState.status === 'idle' || procedureSequenceState.status === 'loading'
    ? '要領書を確認中'
    : currentBolt ? `丸数字 ${currentBolt.markerNo}` : (allBoltsComplete ? '全締付完了' : '次工程待ち');
  const requiredCheckLabel =
    checkSummary && checkSummary.requiredTotal > 0
      ? `必須 ${checkSummary.requiredCompleted}/${checkSummary.requiredTotal}`
      : null;
  const torqueConnectionPresentation = resolveTorqueWrenchConnectionPresentation({
    state: torqueConnection.state,
    currentTemplateBoltId: session.currentBoltId,
    confirmationLookupState,
    hasConfirmation: Boolean(confirmation),
    reachability: torqueConnection.reachability,
    status: torqueConnection.status,
    error: torqueConnection.error
  });
  const visibleMessage = boltConditionOnly && connectionRetryRequired
    ? '確認済み・接続を再試行'
    : torqueConnectionPresentation.connectionMessage ?? message;
  const torqueValueValid = torqueValue.trim().length > 0 && Number.isFinite(Number(torqueValue));
  const actionPresentation = resolveAssemblyWorkActionPresentation({
    sessionActive,
    busy: busy || preparationBusy,
    hasCurrentBolt: Boolean(session.currentBoltId),
    hasCurrentArea: Boolean(session.currentAreaId),
    allBoltsComplete,
    canComplete,
    torqueValueValid,
    selectedProfileId,
    hasConfirmation: Boolean(confirmation),
    leaseOwned: torqueConnection.leaseOwned,
    ownedByOther: torqueConnection.state === 'owned_by_other'
  });
  const boltConnectDisabled = Boolean(
    !sessionActive
    || busy
    || preparationBusy
    || torqueConnection.busy
    || torqueConnection.leaseOwned
    || torqueConnection.state === 'owned_by_other'
    || !session.currentBoltId
    || !selectedProfileId
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 bg-slate-800 p-2 text-white">
      <AssemblyWorkSessionHeader
        productNo={session.productNo}
        modelCode={session.template.modelCode}
        procedurePattern={session.template.procedurePattern}
        procedureModeLabel="要領書"
        currentPositionLabel={currentPositionLabel}
        requiredCheckLabel={requiredCheckLabel}
        statusMessage={visibleMessage}
      />

      <main
        className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto xl:grid-cols-[minmax(0,1fr)_minmax(21rem,27rem)] xl:overflow-hidden"
        data-testid="assembly-work-layout"
      >
        <AssemblyWorkSessionProcedurePane
          procedureSequenceState={procedureSequenceState}
          retryProcedureSequence={retryProcedureSequence}
          visibleBoltMarkers={visibleBoltMarkers}
          visibleCheckMarkers={visibleCheckMarkers}
          session={session}
          currentBolt={currentBolt}
          sessionActive={sessionActive}
          toggleCheckItem={toggleCheckItem}
          handleCurrentPageChange={handleCurrentPageChange}
        />

        <section className="flex min-h-0 flex-col overflow-x-hidden overflow-y-auto rounded border border-white/15 bg-slate-900/70 p-2">
          <h2 className="text-[1.02rem] font-bold">締付</h2>
          <div
            className={`mt-2 rounded border border-white/10 bg-slate-950 p-2 ${displayedHermesGuide?.targetKey === 'current-bolt' ? 'ring-2 ring-cyan-300' : ''}`}
            data-hermes-target="current-bolt"
          >
            <div className="text-sm text-white/60">現在</div>
            <div className="mt-1 text-lg font-bold">{currentBolt ? `丸数字 ${currentBolt.markerNo}` : (allBoltsComplete ? '全締付完了' : '次工程待ち')}</div>
            <div className="mt-1 text-sm text-white/70">
              {currentArea
                ? currentArea.areaName.trim() || `工程${currentArea.sortOrder + 1}`
                : ''}
            </div>
            {currentBolt ? (
              <div className="mt-1 text-sm text-white/80">
                規定 {currentBolt.nominalTorque} / 下限 {currentBolt.lowerLimit} / 上限 {currentBolt.upperLimit} {currentBolt.unit}
              </div>
            ) : null}
          </div>
          <AssemblyWorkSessionGuidePanel
            displayedHermesGuide={displayedHermesGuide}
            hermesGuideBusy={hermesGuideBusy}
            sessionActive={sessionActive}
            requestHermesGuide={requestHermesGuide}
          />
          {checkSummary && checkSummary.requiredTotal > 0 ? (
            <div className="mt-2 rounded border border-lime-300/20 bg-lime-500/10 p-2 text-sm">
              <div className="font-semibold text-lime-100">チェック進捗</div>
              <div className="mt-1 text-lime-50">
                必須 {checkSummary.requiredCompleted}/{checkSummary.requiredTotal}
              </div>
            </div>
          ) : null}
          {traceabilityRequired ? (
            <div className="mt-2 grid grid-cols-2 gap-2 rounded border border-cyan-300/25 bg-cyan-950/20 p-2">
              <div className="col-span-2 flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold">トルクレンチ接続</span>
                <span className={torqueConnection.ready ? 'text-emerald-300' : 'text-amber-200'}>
                  {torqueConnectionPresentation.stateLabel}
                </span>
              </div>
              <label className="col-span-2 grid gap-1 text-xs font-semibold text-white/70">
                使用する物理トルクレンチ
                <select className="min-h-11 w-full min-w-0 max-w-full rounded bg-slate-950 px-2 text-sm" value={selectedProfileId} disabled={!sessionActive || busy || preparationBusy || Boolean(confirmation)} onChange={(e) => setSelectedProfileId(e.target.value)}>
                  {compatibleWrenches.length === 0 ? <option value="">適合レンチなし</option> : null}
                  {compatibleWrenches.map(({ profile }) => {
                    const mode = profile.model.settingVerificationMode;
                    const setting = profile.settingHistories[0];
                    return <option key={profile.id} value={profile.id}>{profile.serialNumber} / {profile.model.modelNumber}{mode === 'BOLT_CONDITION_ONLY' ? ' / 設定照合対象外' : setting ? ` / ${setting.nominalTorque} ${setting.unit}` : ''}</option>;
                  })}
                </select>
              </label>
              {boltConditionOnly ? (
                <>
                  <AssemblyBoltConditionPreparationCard
                    bolt={currentBolt}
                    programLabel={`${session.template.modelCode} / ${session.template.procedurePattern}`}
                    serialNumber={selectedCompatibleWrench?.profile.serialNumber ?? null}
                    busy={preparationBusy || torqueConnection.busy}
                    ready={torqueConnection.ready}
                    retryRequired={connectionRetryRequired}
                    disabled={boltConnectDisabled || confirmationLookupState !== 'resolved'}
                    onConnect={() => void connectBoltConditionWrench()}
                  />
                  {torqueConnection.leaseOwned ? (
                    <button
                      type="button"
                      className={kioskFlowButtonClass(actionPresentation.stopUsingWrench)}
                      disabled={actionPresentation.stopUsingWrench.disabled}
                      onClick={() => void stopUsingWrench()}
                    >
                      使用終了
                    </button>
                  ) : null}
                  {torqueConnection.state === 'owned_by_other' ? (
                    <TorqueWrenchTakeoverPanel
                      owner={torqueConnection.status?.owner ?? null}
                      targetKind="assembly"
                      busy={busy || torqueConnection.busy}
                      onTakeover={takeoverWrench}
                    />
                  ) : null}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={kioskFlowButtonClass(actionPresentation.confirmPhysicalWrench)}
                    disabled={actionPresentation.confirmPhysicalWrench.disabled}
                    onClick={confirmPhysicalWrench}
                  >
                    {confirmation ? '現物確認済み' : '製造番号と現物設定を確認'}
                  </button>
                  {confirmation && !torqueConnection.leaseOwned && torqueConnection.state !== 'owned_by_other' ? (
                    <button
                      type="button"
                      className={kioskFlowButtonClass(actionPresentation.startUsingWrench)}
                      disabled={actionPresentation.startUsingWrench.disabled}
                      onClick={startUsingWrench}
                    >
                      このレンチを使用開始
                    </button>
                  ) : null}
                  {torqueConnection.leaseOwned ? (
                    <button
                      type="button"
                      className={kioskFlowButtonClass(actionPresentation.stopUsingWrench)}
                      disabled={actionPresentation.stopUsingWrench.disabled}
                      onClick={() => void stopUsingWrench()}
                    >
                      使用終了
                    </button>
                  ) : null}
                  {torqueConnection.state === 'owned_by_other' ? (
                    <TorqueWrenchTakeoverPanel
                      owner={torqueConnection.status?.owner ?? null}
                      targetKind="assembly"
                      busy={busy || torqueConnection.busy}
                      onTakeover={takeoverWrench}
                    />
                  ) : null}
                  <div className="col-span-2 rounded bg-slate-950/70 px-3 py-2 text-center text-sm font-semibold">
                    {!confirmation
                      ? '現物確認後に使用開始してください'
                      : torqueConnection.ready
                        ? '入力待機中'
                        : confirmationReused
                          ? '同じ締付条件の現物確認を引継ぎ済み・使用開始が必要です'
                          : '現物確認済み・使用開始が必要です'}
                  </div>
                </>
              )}
            </div>
          ) : (
          <>
          <div className="mt-3 grid grid-cols-[1fr_6rem] gap-2">
            <input
              className="rounded bg-slate-950 px-3 py-3 text-lg"
              value={torqueValue}
              disabled={!sessionActive}
              onChange={(event) => setTorqueValue(event.target.value)}
              placeholder="トルク値"
            />
            <select
              className="rounded bg-slate-950 px-2 text-sm"
              value={torqueSource}
              disabled={!sessionActive}
              onChange={(event) => setTorqueSource(event.target.value as 'manual' | 'mock')}
            >
              <option value="manual">手入力</option>
              <option value="mock">mock</option>
            </select>
          </div>
          <button
            type="button"
            className={kioskFlowButtonClass({ ...actionPresentation.recordTorque, wide: true }) + ' mt-2 w-full'}
            disabled={actionPresentation.recordTorque.disabled}
            onClick={recordTorque}
          >
            トルク記録
          </button>
          </>
          )}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              className={kioskFlowButtonClass(actionPresentation.advanceArea)}
              disabled={actionPresentation.advanceArea.disabled}
              onClick={() => void runBusy(async () => setSession(await advanceAssemblyArea(session.id)))}
            >
              次工程へ
            </button>
            <button
              type="button"
              className={kioskFlowButtonClass(actionPresentation.complete)}
              disabled={actionPresentation.complete.disabled}
              title={completeDisabledReason ?? undefined}
              onClick={completeSession}
            >
              作業完了
            </button>
          </div>
          {completeDisabledReason ? (
            <p className="mt-2 text-xs font-semibold text-amber-200">{completeDisabledReason}</p>
          ) : null}
          <h3 className="mt-3 shrink-0 text-sm font-bold">履歴</h3>
          <div className="mt-2 min-h-32 flex-1 overflow-y-auto rounded border border-white/10">
            {session.torqueRecords.slice().reverse().map((record) => (
              <TorqueResultHistoryRow
                key={record.id}
                locationLabel={`丸数字 ${record.markerNo}${record.serialNumberSnapshot ? ` / ${record.serialNumberSnapshot}` : ''}`}
                recordedAt={record.recordedAt}
                valueLabel={record.value ?? '-'}
                resultLabel={record.judgement.toUpperCase()}
                resultTone={record.judgement === 'ignored' ? 'neutral' : record.judgement === 'ok' ? 'success' : 'failure'}
                details={record.settingVerificationMode === 'BOLT_CONDITION_ONLY' ? '設定照合対象外' : null}
              />
            ))}
          </div>
          <button type="button" className="mt-3 min-h-11 shrink-0 self-start rounded-md border border-[#e5484d] px-3 text-sm font-semibold text-[#e5484d] hover:bg-[#e5484d]/10 disabled:cursor-not-allowed disabled:opacity-40" disabled={actionPresentation.restartArea.disabled} onClick={() => setRestartConfirmOpen(true)}>やり直し</button>
        </section>
      </main>
      <ConfirmDialog
        isOpen={restartConfirmOpen}
        title="このエリアをやり直しますか？"
        description="このエリアの記録を消去し、最初からやり直します。"
        confirmLabel="やり直す"
        cancelLabel="キャンセル"
        tone="danger"
        buttonClassName="min-h-11"
        onCancel={() => setRestartConfirmOpen(false)}
        onConfirm={() => {
          setRestartConfirmOpen(false);
          void runBusy(async () => setSession(await restartAssemblyArea(session.id, { reason: '画面操作によるエリアやり直し' })));
        }}
      />
    </div>
  );
}
