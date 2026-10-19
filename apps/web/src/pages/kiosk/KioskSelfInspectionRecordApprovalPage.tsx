import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { getResolvedClientKey } from '../../api/client';
import {
  useApproveSelfInspectionRecordApproval,
  useResolveSelfInspectionRecordApprovalApprover,
  useSelfInspectionInvalidation,
  useSelfInspectionInvalidations,
  useSelfInspectionRecordApprovalSession,
  useSelfInspectionRecordApprovals,
  useSelfInspectionRegistrationPolicy,
  useUpdateSelfInspectionRegistrationPolicy
} from '../../api/hooks';
import { SelfInspectionRecordApprovalDetail } from '../../features/part-measurement/selfInspectionRecordApproval/SelfInspectionRecordApprovalDetail';
import { SelfInspectionRecordApprovalList } from '../../features/part-measurement/selfInspectionRecordApproval/SelfInspectionRecordApprovalList';
import { SelfInspectionRecordApprovalToolbar } from '../../features/part-measurement/selfInspectionRecordApproval/SelfInspectionRecordApprovalToolbar';
import {
  buildSelfInspectionRecordApprovalListParams,
  readApiErrorMessage,
  type SelfInspectionRecordApprovalFilter
} from '../../features/part-measurement/selfInspectionRecordApproval/selfInspectionRecordApprovalViewModel';
import { SelfInspectionRegistrationPolicyDialog } from '../../features/part-measurement/selfInspectionRecordApproval/SelfInspectionRegistrationPolicyDialog';
import { useNfcStream } from '../../hooks/useNfcStream';

import type {
  SelfInspectionItemInvalidationDto,
  SelfInspectionRecordApprovalSessionListItemDto
} from '../../features/part-measurement/types';

const EMPTY_SESSIONS: SelfInspectionRecordApprovalSessionListItemDto[] = [];
const EMPTY_INVALIDATIONS: SelfInspectionItemInvalidationDto[] = [];

/**
 * The page owns data fetching and workflow state. All visual surfaces below
 * are prop-only components so they can be exercised without API hooks.
 */
export function KioskSelfInspectionRecordApprovalPage() {
  const location = useLocation();
  const clientKey = getResolvedClientKey();
  const [filter, setFilter] = useState<SelfInspectionRecordApprovalFilter>('active');
  const [productNo, setProductNo] = useState('');
  const [resourceCd, setResourceCd] = useState('');
  const requestedSessionId = useMemo(
    () => new URLSearchParams(location.search).get('sessionId'),
    [location.search]
  );
  const [selectedId, setSelectedId] = useState<string | null>(() => requestedSessionId);

  const [approver, setApprover] = useState<{
    employeeCode: string;
    displayName: string;
    nfcTagUid: string;
  } | null>(null);
  const [approvalOperationActive, setApprovalOperationActive] = useState(false);
  const [nfcReading, setNfcReading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const lastProcessedNfcKeyRef = useRef<string | null>(null);

  const [policyDialogOpen, setPolicyDialogOpen] = useState(false);
  const [policyPassword, setPolicyPassword] = useState('');
  const [policyDialogMessage, setPolicyDialogMessage] = useState<string | null>(null);
  const [policyMessage, setPolicyMessage] = useState<string | null>(null);

  // These are deliberately enabled on first render. The kiosk client-key is
  // supplied by the API client/interceptor; no shared-password gate is needed
  // to read the list, detail, invalidation history, or policy.
  const queryOptions = { enabled: true, clientKey };
  const registrationPolicyQuery = useSelfInspectionRegistrationPolicy(queryOptions);
  const updateRegistrationPolicyMutation = useUpdateSelfInspectionRegistrationPolicy();
  const requireMeasuringInstrumentTag =
    registrationPolicyQuery.data?.requireMeasuringInstrumentTag ?? false;

  const listParams = buildSelfInspectionRecordApprovalListParams(filter, productNo, resourceCd);
  // The API hook accepts the domain's parameter model. Keeping this value as a
  // variable also lets the completed_records scope flow through older clients
  // during a rolling web/API deployment.
  const listQuery = useSelfInspectionRecordApprovals(listParams, queryOptions);
  const sessions = listQuery.data?.sessions ?? EMPTY_SESSIONS;

  // Invalidations remain warm even while the user is viewing ordinary records.
  const invalidationListQuery = useSelfInspectionInvalidations(
    {
      productNo: productNo.trim() || undefined,
      resourceCd: resourceCd.trim() || undefined
    },
    queryOptions
  );
  const invalidations = invalidationListQuery.data?.invalidations ?? EMPTY_INVALIDATIONS;

  const detailQuery = useSelfInspectionRecordApprovalSession(selectedId, {
    ...queryOptions,
    enabled: filter !== 'invalidated' && Boolean(selectedId)
  });
  const invalidationDetailQuery = useSelfInspectionInvalidation(selectedId, {
    ...queryOptions,
    enabled: filter === 'invalidated' && Boolean(selectedId)
  });
  const selectedSession = detailQuery.data ?? null;
  const selectedInvalidation = invalidationDetailQuery.data ?? null;

  const resolveApproverMutation = useResolveSelfInspectionRecordApprovalApprover();
  const approveMutation = useApproveSelfInspectionRecordApproval();

  const clearApprovalOperation = useCallback((clearMessage = true) => {
    setApprovalOperationActive(false);
    setNfcReading(false);
    setApprover(null);
    lastProcessedNfcKeyRef.current = null;
    if (clearMessage) setStatusMessage(null);
  }, []);

  const handleFilterChange = useCallback(
    (nextFilter: SelfInspectionRecordApprovalFilter) => {
      if (nextFilter === filter) return;
      setFilter(nextFilter);
      setSelectedId(null);
      clearApprovalOperation();
      setPolicyMessage(null);
      setPolicyDialogOpen(false);
      setPolicyPassword('');
      setPolicyDialogMessage(null);
    },
    [clearApprovalOperation, filter]
  );

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      clearApprovalOperation();
    },
    [clearApprovalOperation]
  );

  const handleOpenPolicyDialog = useCallback(() => {
    setPolicyPassword('');
    setPolicyDialogMessage(null);
    setPolicyDialogOpen(true);
  }, []);

  const handleCancelPolicyDialog = useCallback(() => {
    if (updateRegistrationPolicyMutation.isPending) return;
    setPolicyDialogOpen(false);
    setPolicyPassword('');
    setPolicyDialogMessage(null);
  }, [updateRegistrationPolicyMutation.isPending]);

  const handleSubmitPolicyDialog = useCallback(async () => {
    const accessPassword = policyPassword;
    if (accessPassword.trim().length === 0) {
      setPolicyDialogMessage('操作時パスワードを入力してください。');
      return;
    }

    const next = !requireMeasuringInstrumentTag;
    // Clear the input before awaiting the network response. The value is
    // passed only in this request and is never persisted or retained in UI.
    setPolicyPassword('');
    setPolicyDialogMessage(null);
    try {
      // `accessPassword` is added to the API hook/domain contract by the API
      // workstream. The variable form remains assignable to older clients.
      await updateRegistrationPolicyMutation.mutateAsync({
        requireMeasuringInstrumentTag: next,
        accessPassword
      });
      setPolicyDialogOpen(false);
      setPolicyMessage(`計測機器の使用前点検必須を${next ? 'ON' : 'OFF'}にしました。`);
    } catch (error: unknown) {
      setPolicyDialogMessage(
        readApiErrorMessage(error, '計測機器の使用前点検必須の切替に失敗しました。')
      );
    }
  }, [policyPassword, requireMeasuringInstrumentTag, updateRegistrationPolicyMutation]);

  const isInspectorFinalJudgement =
    selectedSession?.decisionWorkflow === 'INSPECTOR_FINAL_JUDGEMENT';
  const canStartApproval =
    !isInspectorFinalJudgement && selectedSession?.recordApprovalState === 'approvable';
  const canApprove = canStartApproval && approvalOperationActive && approver != null;

  const approveDisabledReason = useMemo(() => {
    if (!selectedSession) return '承認する検査記録を選択してください。';
    if (selectedSession.recordApprovalState === 'inspector_measurement_pending') {
      return '検査員再測定がそろうと承認できます。';
    }
    if (selectedSession.recordApprovalState !== 'approvable') {
      return '入力と使用前点検がそろうと承認できます。';
    }
    if (!approvalOperationActive) return '「承認を開始」を押して社員タグを読み取ります。';
    if (!approver) return '承認者の社員NFCタグをタッチしてください。';
    return null;
  }, [approvalOperationActive, approver, selectedSession]);

  const handleStartApproval = useCallback(() => {
    if (!canStartApproval) return;
    setApprovalOperationActive(true);
    setNfcReading(false);
    setApprover(null);
    lastProcessedNfcKeyRef.current = null;
    setStatusMessage('承認者の社員NFCタグをタッチしてください。');
  }, [canStartApproval]);

  const handleCancelApproval = useCallback(() => {
    clearApprovalOperation();
  }, [clearApprovalOperation]);

  const handleApprove = useCallback(async () => {
    if (!selectedSession || !approver || !canApprove) return;
    setStatusMessage(null);
    try {
      await approveMutation.mutateAsync({
        sessionId: selectedSession.id,
        approverEmployeeTagUid: approver.nfcTagUid,
        comment: null
      });
      clearApprovalOperation(false);
      setStatusMessage('検査記録を承認し、自主検査を完了しました。');
    } catch (error: unknown) {
      setStatusMessage(readApiErrorMessage(error, '承認処理に失敗しました。'));
    }
  }, [approveMutation, approver, canApprove, clearApprovalOperation, selectedSession]);

  const isActiveRoute = location.pathname.startsWith(
    '/kiosk/part-measurement/self-inspection/record-approvals'
  );
  // Arming is explicit. During resolver I/O the stream is disabled so one tag
  // cannot produce concurrent reads or duplicate approver mutations.
  const nfcEvent = useNfcStream(isActiveRoute && approvalOperationActive && !nfcReading);

  useEffect(() => {
    if (!isActiveRoute || !approvalOperationActive || nfcReading) return;
    if (filter === 'invalidated' || isInspectorFinalJudgement || !nfcEvent?.uid) return;
    const key = `${nfcEvent.uid}:${nfcEvent.timestamp ?? ''}`;
    if (lastProcessedNfcKeyRef.current === key) return;
    lastProcessedNfcKeyRef.current = key;
    setNfcReading(true);
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
      })
      .finally(() => {
        setNfcReading(false);
      });
  }, [
    approvalOperationActive,
    filter,
    isActiveRoute,
    isInspectorFinalJudgement,
    nfcEvent,
    nfcReading,
    resolveApproverMutation
  ]);

  useEffect(() => {
    if (filter === 'invalidated') {
      if (invalidations.length === 0) {
        if (!invalidationListQuery.isLoading) setSelectedId(null);
        return;
      }
      if (!selectedId || !invalidations.some((invalidation) => invalidation.id === selectedId)) {
        setSelectedId(invalidations[0].id);
      }
      return;
    }

    if (sessions.length === 0) {
      if (!listQuery.isLoading && !requestedSessionId) setSelectedId(null);
      return;
    }
    if (requestedSessionId && selectedId === requestedSessionId) return;
    if (!selectedId || !sessions.some((session) => session.id === selectedId)) {
      setSelectedId(sessions[0].id);
    }
  }, [
    filter,
    invalidationListQuery.isLoading,
    invalidations,
    listQuery.isLoading,
    requestedSessionId,
    selectedId,
    sessions
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 bg-slate-800 p-3 text-white">
      <SelfInspectionRecordApprovalToolbar
        filter={filter}
        onFilterChange={handleFilterChange}
        productNo={productNo}
        resourceCd={resourceCd}
        onProductNoChange={setProductNo}
        onResourceCdChange={setResourceCd}
        onClearSearch={() => {
          setProductNo('');
          setResourceCd('');
        }}
        requireMeasuringInstrumentTag={requireMeasuringInstrumentTag}
        policyLoading={registrationPolicyQuery.isLoading}
        policyUpdatePending={updateRegistrationPolicyMutation.isPending}
        policyMessage={policyMessage}
        onOpenPolicyDialog={handleOpenPolicyDialog}
        showPolicyControl={filter !== 'invalidated'}
      />

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[22rem_1fr]">
        <SelfInspectionRecordApprovalList
          filter={filter}
          sessions={sessions}
          invalidations={invalidations}
          selectedId={selectedId}
          sessionsLoading={listQuery.isLoading}
          invalidationsLoading={invalidationListQuery.isLoading}
          truncated={
            filter === 'invalidated'
              ? invalidationListQuery.data?.truncated === true
              : listQuery.data?.truncated === true
          }
          onSelect={handleSelect}
        />

        <SelfInspectionRecordApprovalDetail
          filter={filter}
          selectedId={selectedId}
          selectedSession={selectedSession}
          selectedInvalidation={selectedInvalidation}
          sessionLoading={detailQuery.isLoading}
          invalidationLoading={invalidationDetailQuery.isLoading}
          requireMeasuringInstrumentTag={requireMeasuringInstrumentTag}
          approval={{
            approver,
            operationActive: approvalOperationActive,
            nfcReading,
            canStart: canStartApproval,
            canApprove,
            disabledReason: approveDisabledReason,
            statusMessage,
            approvePending: approveMutation.isPending,
            onStart: handleStartApproval,
            onCancel: handleCancelApproval,
            onApprove: () => void handleApprove()
          }}
        />
      </div>

      <SelfInspectionRegistrationPolicyDialog
        open={policyDialogOpen}
        requireMeasuringInstrumentTag={requireMeasuringInstrumentTag}
        password={policyPassword}
        pending={updateRegistrationPolicyMutation.isPending}
        message={policyDialogMessage}
        onPasswordChange={setPolicyPassword}
        onCancel={handleCancelPolicyDialog}
        onSubmit={() => void handleSubmitPolicyDialog()}
      />
    </div>
  );
}
