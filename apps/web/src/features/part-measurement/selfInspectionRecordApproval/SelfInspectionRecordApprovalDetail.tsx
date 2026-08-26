import clsx from 'clsx';
import { Link } from 'react-router-dom';

import { buttonClassName, Button } from '../../../components/ui/Button';
import { toHalfWidthAscii } from '../../kiosk/productionSchedule/machineName';
import {
  kioskSelfInspectionSessionPath
} from '../selfInspectionRoutes';

import {
  formatDateTime,
  formatInstrumentUsageLabel,
  formatParticipantNames,
  getInspectorWorkflowAction,
  inspectorJudgementLabel,
  INVALIDATION_STATE_LABELS,
  stateClassName,
  stateIntentLabel,
  stateLabel,
  type SelfInspectionRecordApprovalFilter
} from './selfInspectionRecordApprovalViewModel';


import type {
  SelfInspectionItemInvalidationDetailDto,
  SelfInspectionRecordApprovalSessionDetailDto
} from '../types';

type ApprovalOperationProps = {
  approver: {
    employeeCode: string;
    displayName: string;
    nfcTagUid: string;
  } | null;
  operationActive: boolean;
  nfcReading: boolean;
  canStart: boolean;
  canApprove: boolean;
  disabledReason: string | null;
  statusMessage: string | null;
  approvePending: boolean;
  onStart: () => void;
  onCancel: () => void;
  onApprove: () => void;
};

type SelfInspectionRecordApprovalDetailProps = {
  filter: SelfInspectionRecordApprovalFilter;
  selectedId: string | null;
  selectedSession: SelfInspectionRecordApprovalSessionDetailDto | null;
  selectedInvalidation: SelfInspectionItemInvalidationDetailDto | null;
  sessionLoading: boolean;
  invalidationLoading: boolean;
  requireMeasuringInstrumentTag: boolean;
  approval: ApprovalOperationProps;
};

function DetailTable({
  session,
  requireMeasuringInstrumentTag
}: {
  session: SelfInspectionRecordApprovalSessionDetailDto;
  requireMeasuringInstrumentTag: boolean;
}) {
  return (
    <div className="min-h-0 overflow-y-auto overflow-x-hidden rounded border border-white/10">
      <table className="w-full table-fixed text-left text-sm" aria-label="測定値一覧">
        <colgroup>
          <col className="w-[6%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[4%]" />
          <col className="w-[14%]" />
          <col className="w-[13%]" />
          <col className="w-[13%]" />
          <col className="w-[7%]" />
          <col className="w-[9%]" />
          <col className="w-[14%]" />
        </colgroup>
        <thead className="sticky top-0 bg-slate-950 text-xs text-white/55">
          <tr>
            <th className="px-2 py-2">入力件</th>
            <th className="px-2 py-2">作業点検</th>
            <th className="px-2 py-2">検査点検</th>
            <th className="px-2 py-2">丸数字</th>
            <th className="px-2 py-2">測定</th>
            <th className="px-2 py-2">オペレータ値</th>
            <th className="px-2 py-2">検査員値</th>
            <th className="px-2 py-2">差分</th>
            <th className="px-2 py-2">差異判定</th>
            <th className="px-2 py-2">合格範囲</th>
          </tr>
        </thead>
        <tbody>
          {session.requiredEntries.flatMap((entry) =>
            entry.values.map((value, valueIndex) => {
              const isJudgement = value.valueKind === 'judgement';
              const outOfTolerance = !isJudgement && value.isWithinTolerance === false;
              const missing = isJudgement ? value.judgementResult == null : value.value == null;
              const operatorDisplay = isJudgement
                ? value.judgementResult === 'PASS'
                  ? 'OK'
                  : value.judgementResult === 'FAIL'
                    ? 'NG'
                    : '未入力'
                : value.value ?? '未入力';
              const inspectorDisplay = isJudgement
                ? value.inspectorJudgementResult === 'PASS'
                  ? 'OK'
                  : value.inspectorJudgementResult === 'FAIL'
                    ? 'NG'
                    : '未入力'
                : value.inspectorValue ?? '未入力';
              const instrumentUsages = entry.entry?.instrumentUsages ?? [];
              const inspectorInstrumentUsages = entry.inspectorEntry?.instrumentUsages ?? [];
              const legacyInstrumentLabel =
                entry.entry?.measuringInstrumentManagementNumberSnapshot &&
                entry.entry?.measuringInstrumentNameSnapshot
                  ? `${entry.entry.measuringInstrumentManagementNumberSnapshot} ${entry.entry.measuringInstrumentNameSnapshot}`
                  : entry.entry?.measuringInstrumentNameSnapshot;
              const inspectorLegacyInstrumentLabel =
                entry.inspectorEntry?.measuringInstrumentManagementNumberSnapshot &&
                entry.inspectorEntry?.measuringInstrumentNameSnapshot
                  ? `${entry.inspectorEntry.measuringInstrumentManagementNumberSnapshot} ${entry.inspectorEntry.measuringInstrumentNameSnapshot}`
                  : entry.inspectorEntry?.measuringInstrumentNameSnapshot;
              const operatorInstrumentLabel =
                instrumentUsages.length > 0
                  ? instrumentUsages.map(formatInstrumentUsageLabel).join(' / ')
                  : legacyInstrumentLabel ?? (requireMeasuringInstrumentTag ? '未点検' : '任意');
              const inspectorInstrumentLabel =
                inspectorInstrumentUsages.length > 0
                  ? inspectorInstrumentUsages.map(formatInstrumentUsageLabel).join(' / ')
                  : inspectorLegacyInstrumentLabel ??
                    (requireMeasuringInstrumentTag ? '未点検' : '任意');
              return (
                <tr
                  key={`${entry.entryIndex}:${value.templateItemId}`}
                  className={clsx(
                    'h-14 border-t border-white/10',
                    outOfTolerance ? 'bg-red-500/30 shadow-[inset_4px_0_0_#fb7185]' : missing && 'bg-slate-600/15'
                  )}
                >
                  {valueIndex === 0 ? (
                    <td className="whitespace-nowrap px-2 py-1 align-top" rowSpan={entry.values.length}>
                      <div className="font-semibold">{entry.entrySlotLabel}</div>
                      <div className="text-[10px] text-white/45">#{entry.entryIndex + 1}</div>
                    </td>
                  ) : null}
                  {valueIndex === 0 ? (
                    <td
                      className="px-2 py-1 align-top"
                      rowSpan={entry.values.length}
                      title={`${entry.entry?.createdByEmployeeNameSnapshot ?? '未登録'} / 保存 ${entry.entry?.updatedAt ? formatDateTime(entry.entry.updatedAt) : '未保存'} / ${operatorInstrumentLabel}`}
                    >
                      <div className={clsx('truncate font-semibold', entry.entry?.createdByEmployeeNameSnapshot ? 'text-emerald-100' : 'text-amber-100')}>
                        {entry.entry?.createdByEmployeeNameSnapshot ?? '未登録'}
                      </div>
                      <div className="truncate text-[10px] text-white/55">
                        保存 {entry.entry?.updatedAt ? formatDateTime(entry.entry.updatedAt) : '未保存'}
                      </div>
                      <div className={clsx('truncate text-[10px]', operatorInstrumentLabel === '未点検' ? 'text-amber-100' : 'text-emerald-100/85')}>
                        {operatorInstrumentLabel}
                      </div>
                    </td>
                  ) : null}
                  {valueIndex === 0 ? (
                    <td
                      className="px-2 py-1 align-top"
                      rowSpan={entry.values.length}
                      title={`${entry.inspectorEntry?.inspectorEmployeeNameSnapshot ?? '未登録'} / 保存 ${entry.inspectorEntry?.updatedAt ? formatDateTime(entry.inspectorEntry.updatedAt) : '未保存'} / ${inspectorInstrumentLabel}`}
                    >
                      <div className={clsx('truncate font-semibold', entry.inspectorEntry?.inspectorEmployeeNameSnapshot ? 'text-sky-100' : 'text-amber-100')}>
                        {entry.inspectorEntry?.inspectorEmployeeNameSnapshot ?? '未登録'}
                      </div>
                      <div className="truncate text-[10px] text-white/55">
                        保存 {entry.inspectorEntry?.updatedAt ? formatDateTime(entry.inspectorEntry.updatedAt) : '未保存'}
                      </div>
                      <div className={clsx('truncate text-[10px]', inspectorInstrumentLabel === '未点検' ? 'text-amber-100' : 'text-sky-100/85')}>
                        {inspectorInstrumentLabel}
                      </div>
                    </td>
                  ) : null}
                  <td className="px-2 py-1 text-center text-base font-semibold">{value.displayMarker ?? '-'}</td>
                  <td className="px-2 py-1">
                    <div className="font-semibold">{value.measurementLabel}</div>
                    <div className="truncate text-[10px] text-white/50">{value.measurementPoint}</div>
                  </td>
                  <td
                    className={clsx(
                      'whitespace-nowrap px-2 py-1 font-mono',
                      outOfTolerance ? 'text-red-100' : missing ? 'text-amber-100' : 'text-white'
                    )}
                  >
                    <span className="text-[1.75rem] font-bold leading-none">{operatorDisplay}</span>
                    {!isJudgement && value.value && value.unit ? (
                      <span className="ml-1 text-xs text-current/75">{value.unit}</span>
                    ) : null}
                  </td>
                  <td
                    className={clsx(
                      'whitespace-nowrap px-2 py-1 font-mono',
                      (isJudgement ? value.inspectorJudgementResult : value.inspectorValue) == null
                        ? 'text-amber-100'
                        : 'text-sky-100'
                    )}
                  >
                    <span className="text-[1.75rem] font-bold leading-none">{inspectorDisplay}</span>
                    {!isJudgement && value.inspectorValue && value.unit ? (
                      <span className="ml-1 text-xs text-current/75">{value.unit}</span>
                    ) : null}
                  </td>
                  <td className="truncate px-2 py-1 font-mono text-white/75">
                    {isJudgement ? '—' : value.differenceValue ?? '-'}
                  </td>
                  <td className="truncate px-2 py-1 text-white/75">
                    {inspectorJudgementLabel(value.inspectorJudgementStatus)}
                  </td>
                  <td className="truncate px-2 py-1 font-mono text-white/75">
                    {isJudgement ? 'OK/NG判定' : `${value.lowerLimit ?? '-'} - ${value.upperLimit ?? '-'}`}
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

function InvalidationHistoryDetail({
  invalidation
}: {
  invalidation: SelfInspectionItemInvalidationDetailDto;
}) {
  const session = invalidation.session;
  const inspectorEntryByIndex = new Map(
    (session?.inspectorEntries ?? []).map((entry) => [entry.entryIndex, entry])
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="rounded border border-rose-300/50 bg-rose-500/15 p-3 text-rose-50">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold">{invalidation.productNoSnapshot}</h2>
              <span className="rounded bg-rose-500/30 px-2 py-1 text-xs font-bold">削除済み・閲覧専用</span>
            </div>
            <p className="text-sm text-rose-100/85">
              {invalidation.fhincdSnapshot} / {invalidation.fhinmeiSnapshot} / 資源{' '}
              {invalidation.resourceCdSnapshot}
              {invalidation.fseibanSnapshot ? ` / 製番 ${invalidation.fseibanSnapshot}` : ''}
            </p>
          </div>
          <div className="text-right text-xs text-rose-100/80">
            <p>削除 {formatDateTime(invalidation.invalidatedAt)}</p>
            <p>削除前 {INVALIDATION_STATE_LABELS[invalidation.sourceState]}</p>
          </div>
        </div>
        <dl className="mt-3 grid gap-x-3 gap-y-1 border-t border-rose-200/20 pt-3 text-sm sm:grid-cols-[7rem_1fr]">
          <dt className="font-semibold text-rose-100/65">削除理由</dt>
          <dd className="whitespace-pre-wrap font-semibold">{invalidation.reason}</dd>
          <dt className="font-semibold text-rose-100/65">実行者</dt>
          <dd>{invalidation.invalidatedByUsernameSnapshot ?? 'キオスク端末'}</dd>
          <dt className="font-semibold text-rose-100/65">端末</dt>
          <dd>
            {invalidation.invalidatedByClientDeviceNameSnapshot ??
              invalidation.invalidatedByClientDeviceId ??
              '—'}
          </dd>
        </dl>
      </div>

      {!session ? (
        <div className="rounded border border-white/15 bg-slate-950/40 py-12 text-center text-white/60">
          未開始で削除されたため、測定履歴はありません。
        </div>
      ) : (
        <>
          <div className="min-h-0 overflow-auto rounded border border-white/10">
            <table className="min-w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-950 text-xs text-white/55">
                <tr>
                  <th className="px-3 py-2">入力件</th>
                  <th className="px-3 py-2">測定点</th>
                  <th className="px-3 py-2">作業者値</th>
                  <th className="px-3 py-2">検査員値</th>
                  <th className="px-3 py-2">入力者</th>
                </tr>
              </thead>
              <tbody>
                {session.entries.flatMap((entry) =>
                  entry.values.map((value, valueIndex) => {
                    const inspectorValue = inspectorEntryByIndex
                      .get(entry.entryIndex)
                      ?.values.find((candidate) => candidate.templateItemId === value.templateItemId);
                    return (
                      <tr key={`${entry.id}:${value.id}`} className="border-t border-white/10">
                        {valueIndex === 0 ? (
                          <td className="whitespace-nowrap px-3 py-2 align-top" rowSpan={entry.values.length}>
                            #{entry.entryIndex + 1}
                          </td>
                        ) : null}
                        <td className="px-3 py-2">
                          <div className="font-semibold">
                            {value.templateItem.displayMarker ?? '—'} {value.templateItem.measurementLabel}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {value.judgementResult ?? value.value ?? '未入力'}
                          {value.value && value.templateItem.unit ? ` ${value.templateItem.unit}` : ''}
                        </td>
                        <td className="px-3 py-2 font-mono text-sky-100">
                          {inspectorValue?.inspectorJudgementResult ?? inspectorValue?.inspectorValue ?? '—'}
                        </td>
                        {valueIndex === 0 ? (
                          <td className="px-3 py-2 align-top text-white/70" rowSpan={entry.values.length}>
                            {entry.createdByEmployeeNameSnapshot ?? '未登録'}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded border border-white/10 bg-slate-950/40 p-3">
              <h3 className="font-semibold">承認履歴</h3>
              {session.recordApproval ? (
                <p className="mt-2 text-sm text-white/70">
                  {formatDateTime(session.recordApproval.approvedAt)} /{' '}
                  {session.recordApproval.approverEmployeeNameSnapshot}
                  {session.recordApproval.comment ? ` / ${session.recordApproval.comment}` : ''}
                </p>
              ) : (
                <p className="mt-2 text-sm text-white/50">承認履歴なし</p>
              )}
            </div>
            <div className="rounded border border-white/10 bg-slate-950/40 p-3">
              <h3 className="font-semibold">紙帳票履歴</h3>
              {session.paperReports.length > 0 ? (
                <div className="mt-2 grid gap-1 text-sm text-white/70">
                  {session.paperReports.map((report) => (
                    <p key={report.id}>
                      {formatDateTime(report.issuedAt)} / {report.status} / {report.pages.length}ページ
                    </p>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-white/50">紙帳票履歴なし</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ApprovalPanel({
  operation
}: {
  operation: ApprovalOperationProps;
}) {
  return (
    <div className="grid gap-2 rounded border border-white/10 bg-slate-950/40 p-3 md:grid-cols-[1fr_auto]">
      <div>
        <p className="text-sm font-semibold text-white/80">承認者NFC</p>
        <p
          className={clsx(
            'mt-1 rounded border px-3 py-2 text-sm',
            operation.approver
              ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
              : operation.nfcReading
                ? 'border-sky-400/40 bg-sky-500/10 text-sky-100'
                : 'border-white/15 bg-white/5 text-white/55'
          )}
        >
          {operation.nfcReading
            ? '承認者タグを確認中です...'
            : operation.approver
              ? `${operation.approver.employeeCode} ${operation.approver.displayName}`
              : operation.operationActive
                ? '社員タグをタッチしてください'
                : '「承認を開始」を押すと社員タグを読み取れます'}
        </p>
        {operation.statusMessage ? (
          <p className="mt-2 rounded border border-amber-400/40 bg-amber-500/15 px-3 py-2 text-sm text-amber-100">
            {operation.statusMessage}
          </p>
        ) : operation.disabledReason ? (
          <p className="mt-2 text-xs text-white/55">{operation.disabledReason}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-end justify-end gap-2 self-end">
        {operation.operationActive ? (
          <Button
            type="button"
            variant="ghostOnDark"
            disabled={operation.approvePending || operation.nfcReading}
            onClick={operation.onCancel}
          >
            キャンセル
          </Button>
        ) : null}
        {!operation.approver ? (
          <Button
            type="button"
            disabled={!operation.canStart || operation.approvePending}
            onClick={operation.onStart}
            className="min-w-44"
          >
            承認を開始
          </Button>
        ) : (
          <Button
            type="button"
            disabled={!operation.canApprove || operation.approvePending}
            onClick={operation.onApprove}
            className="min-w-44"
          >
            {operation.approvePending ? '承認中...' : '承認して完了'}
          </Button>
        )}
      </div>
    </div>
  );
}

export function SelfInspectionRecordApprovalDetail({
  filter,
  selectedId,
  selectedSession,
  selectedInvalidation,
  sessionLoading,
  invalidationLoading,
  requireMeasuringInstrumentTag,
  approval
}: SelfInspectionRecordApprovalDetailProps) {
  if (filter === 'invalidated') {
    return (
      <section className="flex min-h-0 flex-col gap-3 rounded border border-white/15 bg-slate-900/70 p-3">
        {!selectedId ? (
          <div className="py-16 text-center text-white/55">左の一覧から削除履歴を選択してください。</div>
        ) : invalidationLoading && !selectedInvalidation ? (
          <div className="py-16 text-center text-white/55">削除履歴の詳細を読込中...</div>
        ) : !selectedInvalidation ? (
          <div className="py-16 text-center text-white/55">削除履歴を表示できません。</div>
        ) : (
          <InvalidationHistoryDetail invalidation={selectedInvalidation} />
        )}
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-col gap-3 rounded border border-white/15 bg-slate-900/70 p-3">
      {!selectedId ? (
        <div className="py-16 text-center text-white/55">左の一覧から検査記録を選択してください。</div>
      ) : sessionLoading && !selectedSession ? (
        <div className="py-16 text-center text-white/55">詳細を読込中...</div>
      ) : !selectedSession ? (
        <div className="py-16 text-center text-white/55">検査記録を表示できません。</div>
      ) : (
        <>
          <div
            className="rounded border border-white/10 bg-slate-950/40 px-3"
            role="region"
            aria-label="選択中の検査記録"
          >
            <div className="flex min-h-11 min-w-0 items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2 text-lg font-bold">
                <span
                  className={clsx(
                    'shrink-0 rounded px-2 py-1 text-xs font-semibold',
                    stateClassName(selectedSession.recordApprovalState)
                  )}
                >
                  {stateLabel(selectedSession.recordApprovalState)}
                </span>
                <span className="truncate text-xs font-semibold text-amber-100">
                  {stateIntentLabel(selectedSession.recordApprovalState)}
                </span>
                <span className="truncate">{selectedSession.fseiban || '製番未登録'}</span>
                <span className="shrink-0">{selectedSession.resourceCd}</span>
                <span className="truncate">{selectedSession.fhinmei}</span>
              </div>
              <div className="flex shrink-0 gap-2">
                <Link
                  to={kioskSelfInspectionSessionPath(selectedSession.id)}
                  className={buttonClassName(
                    'ghostOnDark',
                    'inline-flex min-w-32 items-center justify-center border-0 bg-violet-500/20 text-violet-100'
                  )}
                >
                  作業者入力へ
                </Link>
                {getInspectorWorkflowAction(selectedSession) ? (
                  <Link
                    to={getInspectorWorkflowAction(selectedSession)!.href}
                    className={buttonClassName(
                      'secondary',
                      'inline-flex min-w-32 items-center justify-center'
                    )}
                  >
                    {getInspectorWorkflowAction(selectedSession)!.label}
                  </Link>
                ) : null}
              </div>
            </div>
            <div className="flex min-h-9 min-w-0 items-center gap-3 border-t border-white/10 text-xs text-white/55">
              <span className="shrink-0 text-lg font-bold text-white">{selectedSession.productNo}</span>
              <span className="shrink-0">{selectedSession.fhincd}</span>
              <span className="truncate">
                入力 {selectedSession.completedRequiredEntryCount}/{selectedSession.requiredEntryCount}件
                {selectedSession.decisionWorkflow === 'INSPECTOR_FINAL_JUDGEMENT'
                  ? ` / 最終判定待ち ${selectedSession.pendingReviewCount}点`
                  : ` / 公差外承認待ち ${selectedSession.pendingReviewCount}点`}
                {selectedSession.recordApproval
                  ? ` / 承認 ${formatDateTime(selectedSession.recordApproval.approvedAt)} ${selectedSession.recordApproval.approverEmployeeNameSnapshot}`
                  : ''}
              </span>
              <span className="truncate">
                更新 {formatDateTime(selectedSession.updatedAt)} / 入力者{' '}
                {formatParticipantNames(selectedSession.participantEmployeeNames)}
              </span>
              <span className="ml-auto shrink-0 text-base font-bold text-white">
                {toHalfWidthAscii(selectedSession.machineName?.trim() ?? '') || '—'}
              </span>
            </div>
          </div>

          {selectedSession.decisionWorkflow !== 'INSPECTOR_FINAL_JUDGEMENT' ? (
            <ApprovalPanel operation={approval} />
          ) : null}

          <DetailTable
            session={selectedSession}
            requireMeasuringInstrumentTag={requireMeasuringInstrumentTag}
          />
        </>
      )}
    </section>
  );
}
