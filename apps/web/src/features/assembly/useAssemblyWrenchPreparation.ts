import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  confirmAssemblyTorqueWrench,
  listCompatibleTorqueWrenchesForSession,
  listCurrentTorqueWrenchConfirmations
} from '../../api/client';

import { readAssemblyApiErrorMessage } from './assemblyUiHelpers';

import type { TorqueWrenchProfileApi } from '../../api/domains/torque-wrenches';
import type { TorqueWrenchConnectionContext } from '../torque-wrench-connection';
import type {
  UseTorqueWrenchConnectionResult
} from '../torque-wrench-connection/useTorqueWrenchConnection';
import type { TorqueWrenchSettingVerificationMode } from '@raspi-system/shared-types';


export type AssemblyCompatibleWrench = {
  profile: TorqueWrenchProfileApi;
  conditionFingerprint: string;
};

export type AssemblyWrenchConfirmation = {
  id: string;
  sessionId: string;
  torqueWrenchProfileId: string;
  settingHistoryId: string | null;
  settingVerificationMode: TorqueWrenchSettingVerificationMode;
  conditionFingerprint: string;
};

type Options = {
  sessionId: string | null;
  currentTemplateBoltId: string | null;
  sessionActive: boolean;
  traceabilityRequired: boolean;
  connectionRef: { current: Pick<UseTorqueWrenchConnectionResult, 'acquire' | 'clearError'> | null };
  onConditionStale?: () => void;
  onMessage: (message: string | null) => void;
};

type FreshConfirmationError = {
  code?: unknown;
  state?: unknown;
  lastError?: unknown;
  payload?: unknown;
  response?: { data?: unknown };
};

function profileMode(profile: TorqueWrenchProfileApi): TorqueWrenchSettingVerificationMode {
  return profile.model.settingVerificationMode;
}

function requestId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
}

/**
 * These responses invalidate the confirmation snapshot. Transport failures
 * intentionally do not: the same confirmation/requestId is safe to retry.
 */
export function requiresFreshAssemblyWrenchConfirmation(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as FreshConfirmationError;
  if (candidate.state === 'fenced' || candidate.state === 'expired') return true;

  const payload = candidate.payload;
  const payloadCode = payload && typeof payload === 'object'
    ? (payload as { code?: unknown; errorCode?: unknown; lastError?: unknown }).code
      ?? (payload as { errorCode?: unknown }).errorCode
      ?? (payload as { lastError?: unknown }).lastError
    : null;
  const responseData = candidate.response?.data;
  const responseCode = responseData && typeof responseData === 'object'
    ? (responseData as { code?: unknown; errorCode?: unknown; lastError?: unknown }).code
      ?? (responseData as { errorCode?: unknown }).errorCode
      ?? (responseData as { lastError?: unknown }).lastError
    : null;
  const text = [candidate.code, candidate.lastError, payloadCode, responseCode, value instanceof Error ? value.message : null]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toUpperCase();

  return text.includes('CONFIRMATION_REQUIRED')
    || text.includes('CONFIRMATION_STALE')
    || text.includes('STALE_CONFIRMATION')
    || text.includes('STALE_TEMPLATE_BOLT')
    || text.includes('SETTING_VERIFICATION_MODE_CHANGED')
    || text.includes('TORQUE_WRENCH_LEASE_FENCED')
    || text.includes('TORQUE_WRENCH_LEASE_EXPIRED')
    || text.includes('BINDING_FENCED');
}

export function useAssemblyWrenchPreparation({
  sessionId,
  currentTemplateBoltId,
  sessionActive,
  traceabilityRequired,
  connectionRef,
  onConditionStale,
  onMessage
}: Options) {
  const [compatibleWrenches, setCompatibleWrenches] = useState<AssemblyCompatibleWrench[]>([]);
  const [selectedProfileId, setSelectedProfileIdState] = useState('');
  const [confirmation, setConfirmationState] = useState<AssemblyWrenchConfirmation | null>(null);
  const [confirmationReused, setConfirmationReused] = useState(false);
  const [confirmationLookupState, setConfirmationLookupState] = useState<'idle' | 'loading' | 'resolved'>('idle');
  const [connectionRetryRequired, setConnectionRetryRequired] = useState(false);
  const [preparationBusy, setPreparationBusy] = useState(false);
  const [lookupRevision, setLookupRevision] = useState(0);
  const confirmationRef = useRef<AssemblyWrenchConfirmation | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const operationInFlightRef = useRef(false);
  const onMessageRef = useRef(onMessage);
  const sessionIdentityRef = useRef(sessionId);

  // Route changes can reuse this component instance. Do not let a previous
  // session's confirmation/requestId participate in the new binding even for
  // the render before the lookup effect runs.
  const sessionChanged = sessionIdentityRef.current !== sessionId;
  if (sessionChanged) {
    sessionIdentityRef.current = sessionId;
    confirmationRef.current = null;
    requestIdRef.current = null;
    operationInFlightRef.current = false;
  }

  onMessageRef.current = onMessage;

  const setConfirmation = useCallback((next: AssemblyWrenchConfirmation | null) => {
    confirmationRef.current = next;
    setConfirmationState(next);
  }, []);

  const resetPreparation = useCallback(() => {
    setConfirmation(null);
    setConfirmationReused(false);
    setConnectionRetryRequired(false);
    requestIdRef.current = null;
  }, [setConfirmation]);

  const resetAfterRelease = useCallback(() => {
    if (confirmationRef.current?.settingVerificationMode === 'BOLT_CONDITION_ONLY') {
      resetPreparation();
    }
  }, [resetPreparation]);

  const resetAfterExpiry = useCallback(() => {
    if (confirmationRef.current?.settingVerificationMode === 'BOLT_CONDITION_ONLY') {
      resetPreparation();
    }
  }, [resetPreparation]);

  const setSelectedProfileId = useCallback((next: string) => {
    if (next !== selectedProfileId) resetPreparation();
    setSelectedProfileIdState(next);
  }, [resetPreparation, selectedProfileId]);

  const selectedCompatibleWrench = useMemo(
    () => compatibleWrenches.find(({ profile }) => profile.id === selectedProfileId) ?? null,
    [compatibleWrenches, selectedProfileId]
  );
  const sessionScopedConfirmation = confirmation?.sessionId === sessionId ? confirmation : null;
  const visibleCompatibleWrenches = sessionChanged ? [] : compatibleWrenches;
  const visibleSelectedProfileId = sessionChanged ? '' : selectedProfileId;
  const visibleSelectedCompatibleWrench = sessionChanged ? null : selectedCompatibleWrench;
  const selectedSettingVerificationMode =
    visibleSelectedCompatibleWrench?.profile.model.settingVerificationMode
    ?? sessionScopedConfirmation?.settingVerificationMode
    ?? 'REGISTERED_SETTING';
  const boltConditionOnly = selectedSettingVerificationMode === 'BOLT_CONDITION_ONLY';

  useEffect(() => {
    if (!sessionActive || !sessionId || !currentTemplateBoltId || !traceabilityRequired) {
      setCompatibleWrenches([]);
      setSelectedProfileIdState('');
      resetPreparation();
      setConfirmationLookupState('idle');
      return;
    }

    let cancelled = false;
    setConfirmationLookupState('loading');
    void listCompatibleTorqueWrenchesForSession(sessionId)
      .then(async (items) => {
        if (cancelled) return;
        setCompatibleWrenches(items);
        const registeredItems = items.filter(({ profile }) => profileMode(profile) === 'REGISTERED_SETTING');
        // BOLT-condition-only profiles deliberately do not consult historical
        // confirmations. A profile match alone must never select one.
        const confirmations = registeredItems.length
          ? await listCurrentTorqueWrenchConfirmations(sessionId)
          : [];
        if (cancelled) return;

        const previous = confirmationRef.current;
        const previousItem = previous
          ? items.find(({ profile, conditionFingerprint }) =>
              previous.sessionId === sessionId
              && profile.id === previous.torqueWrenchProfileId
              && conditionFingerprint === previous.conditionFingerprint
              && profileMode(profile) === previous.settingVerificationMode
            )
          : null;
        const previousStillCurrent = Boolean(
          previous
          && previousItem
          && (previous.settingVerificationMode === 'BOLT_CONDITION_ONLY'
            || confirmations.some((candidate) => candidate.id === previous.id))
        );
        const reusable = previousStillCurrent
          ? null
          : confirmations.find((candidate) => {
              const item = items.find(({ profile }) => profile.id === candidate.torqueWrenchProfileId);
              return item && profileMode(item.profile) === 'REGISTERED_SETTING';
            });
        const selectedId = previousStillCurrent
          ? previous!.torqueWrenchProfileId
          : reusable?.torqueWrenchProfileId ?? items[0]?.profile.id ?? '';
        setSelectedProfileIdState(selectedId);
        if (previousStillCurrent) {
          setConfirmation(previous);
          setConfirmationReused(true);
        } else if (reusable) {
          const item = items.find(({ profile }) => profile.id === reusable.torqueWrenchProfileId);
          setConfirmation({
            id: reusable.id,
            sessionId,
            torqueWrenchProfileId: reusable.torqueWrenchProfileId,
            settingHistoryId: reusable.settingHistoryId,
            settingVerificationMode: reusable.settingVerificationMode,
            conditionFingerprint: item?.conditionFingerprint ?? ''
          });
          setConfirmationReused(true);
          setConnectionRetryRequired(false);
          requestIdRef.current = null;
        } else {
          resetPreparation();
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) onMessageRef.current(readAssemblyApiErrorMessage(error, '適合トルクレンチを取得できませんでした。'));
      })
      .finally(() => {
        if (!cancelled) setConfirmationLookupState('resolved');
      });

    return () => {
      cancelled = true;
    };
  }, [currentTemplateBoltId, lookupRevision, resetPreparation, sessionActive, sessionId, setConfirmation, traceabilityRequired]);

  const confirmPhysicalWrench = useCallback(async () => {
    if (!sessionId || !currentTemplateBoltId || !selectedProfileId) {
      onMessageRef.current('確認する物理トルクレンチを選択してください。');
      return;
    }
    if (operationInFlightRef.current) return;
    operationInFlightRef.current = true;
    setPreparationBusy(true);
    onMessageRef.current(null);
    try {
      const next = await confirmAssemblyTorqueWrench(sessionId, {
        expectedTemplateBoltId: currentTemplateBoltId,
        torqueWrenchProfileId: selectedProfileId,
        physicalDisplayConfirmed: true
      });
      const item = selectedCompatibleWrench;
      setConfirmation({
        id: next.id,
        sessionId,
        torqueWrenchProfileId: next.torqueWrenchProfileId,
        settingHistoryId: next.settingHistoryId,
        settingVerificationMode: next.settingVerificationMode,
        conditionFingerprint: item?.conditionFingerprint ?? ''
      });
      setConfirmationReused(false);
      setConnectionRetryRequired(false);
      requestIdRef.current = null;
      onMessageRef.current('現物の製造番号と設定値を確認済みにしました。「このレンチを使用開始」を押してください。');
    } catch (error: unknown) {
      setConfirmation(null);
      onMessageRef.current(readAssemblyApiErrorMessage(error, 'トルクレンチの現物確認に失敗しました。'));
    } finally {
      setPreparationBusy(false);
      operationInFlightRef.current = false;
    }
  }, [currentTemplateBoltId, selectedCompatibleWrench, selectedProfileId, sessionId, setConfirmation]);

  const connectBoltConditionWrench = useCallback(async () => {
    if (!sessionId || !currentTemplateBoltId || !selectedProfileId || !boltConditionOnly) return;
    if (operationInFlightRef.current) return;
    operationInFlightRef.current = true;
    setPreparationBusy(true);
    onMessageRef.current(null);
    setConnectionRetryRequired(false);
    let confirmationReady = false;
    try {
      const selectedFingerprint = selectedCompatibleWrench?.conditionFingerprint;
      if (!selectedFingerprint) throw new Error('現在のボルト条件を取得できません。');
      let nextConfirmation = confirmationRef.current;
      if (
        !nextConfirmation
        || nextConfirmation.torqueWrenchProfileId !== selectedProfileId
        || nextConfirmation.conditionFingerprint !== selectedFingerprint
        || nextConfirmation.settingVerificationMode !== 'BOLT_CONDITION_ONLY'
      ) {
        const next = await confirmAssemblyTorqueWrench(sessionId, {
          expectedTemplateBoltId: currentTemplateBoltId,
          torqueWrenchProfileId: selectedProfileId,
          physicalDisplayConfirmed: true
        });
        if (next.settingVerificationMode !== 'BOLT_CONDITION_ONLY') {
          throw { code: 'SETTING_VERIFICATION_MODE_CHANGED' } satisfies FreshConfirmationError;
        }
        nextConfirmation = {
          id: next.id,
          sessionId,
          torqueWrenchProfileId: next.torqueWrenchProfileId,
          settingHistoryId: next.settingHistoryId,
          settingVerificationMode: next.settingVerificationMode,
          conditionFingerprint: selectedFingerprint
        };
        setConfirmation(nextConfirmation);
        setConfirmationReused(false);
      }
      confirmationReady = true;
      const connectionRequestId = requestIdRef.current ?? requestId('assembly-bolt-agent');
      requestIdRef.current = connectionRequestId;
      const binding: TorqueWrenchConnectionContext = {
        targetKind: 'assembly',
        sessionId,
        currentTemplateBoltId,
        confirmationId: nextConfirmation.id,
        torqueWrenchProfileId: nextConfirmation.torqueWrenchProfileId
      };
      const currentConnection = connectionRef.current;
      if (!currentConnection) throw new Error('トルクレンチ接続を準備できません。');
      const agentStatus = await currentConnection.acquire(connectionRequestId, binding);
      if (requiresFreshAssemblyWrenchConfirmation(agentStatus)) throw agentStatus;
      if (!agentStatus) throw new Error('Pi3 torque-agentへ接続できませんでした。');
      if (!agentStatus.leaseOwned && agentStatus.state !== 'owned_by_other') {
        throw new Error(agentStatus.lastError ?? 'Pi3 torque-agentへ接続できませんでした。');
      }
      onMessageRef.current(agentStatus.state === 'owned_by_other'
        ? '別の作業または端末が使用中です。現物が手元にある場合だけ引継ぎ操作を行ってください。'
        : 'レンチ接続を確認しました。');
    } catch (error: unknown) {
      if (requiresFreshAssemblyWrenchConfirmation(error)) {
        resetPreparation();
        setLookupRevision((current) => current + 1);
        onConditionStale?.();
        onMessageRef.current('確認状態が古くなりました。現在のボルト条件を確認して接続し直してください。');
      } else if (confirmationReady) {
        connectionRef.current?.clearError();
        setConnectionRetryRequired(true);
        onMessageRef.current('確認済み・接続を再試行');
      } else {
        onMessageRef.current(readAssemblyApiErrorMessage(error, 'レンチを接続できませんでした。'));
      }
    } finally {
      setPreparationBusy(false);
      operationInFlightRef.current = false;
    }
  }, [boltConditionOnly, connectionRef, currentTemplateBoltId, resetPreparation, selectedCompatibleWrench, selectedProfileId, sessionId, setConfirmation, onConditionStale]);

  return {
    compatibleWrenches: visibleCompatibleWrenches,
    selectedProfileId: visibleSelectedProfileId,
    setSelectedProfileId,
    selectedCompatibleWrench: visibleSelectedCompatibleWrench,
    confirmation: sessionScopedConfirmation,
    confirmationReused: sessionScopedConfirmation ? confirmationReused : false,
    confirmationLookupState: sessionChanged ? 'loading' : confirmationLookupState,
    connectionRetryRequired: sessionScopedConfirmation ? connectionRetryRequired : false,
    preparationBusy,
    selectedSettingVerificationMode,
    boltConditionOnly,
    confirmPhysicalWrench,
    connectBoltConditionWrench,
    resetPreparation,
    resetAfterRelease,
    resetAfterExpiry
  };
}
