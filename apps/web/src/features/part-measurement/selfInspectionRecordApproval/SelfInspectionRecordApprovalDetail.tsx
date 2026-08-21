import clsx from 'clsx';
import { Link } from 'react-router-dom';

import { buttonClassName, Button } from '../../../components/ui/Button';
import {
  kioskSelfInspectionInspectorSessionPath,
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
    <div className="min-h-0 overflow-auto rounded border border-white/10">
      <table className="min-w-full text-left text-sm">
        <thead className="sticky top-0 bg-slate-950 text-xs text-white/55">
          <tr>
            <th className="px-3 py-2">入力件</th>
            <th className="px-3 py-2">点検</th>
            <th className="px-3 py-2">丸数字</th>
            <th className="px-3 py-2">測定</th>
            <th className="px-3 py-2">オペレータ値</th>
            <th className="px-3 py-2">検査員値</th>
            <th className="px-3 py-2">差分</th>
            <th className="px-3 py-2">差異判定</th>
            <th className="px-3 py-2">合格範囲</th>
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
              return (
                <tr
                  key={`${entry.entryIndex}:${value.templateItemId}`}
                  className={clsx(
                    'border-t border-white/10',
                    outOfTolerance && 'bg-red-500/10',
                    missing && 'bg-slate-600/15'
                  )}
                >
                  {valueIndex === 0 ? (
                    <td className="whitespace-nowrap px-3 py-2 align-top" rowSpan={entry.values.length}>
                      <div className="font-semibold">{entry.entrySlotLabel}</div>
                      <div className="text-xs text-white/45">#{entry.entryIndex + 1}</div>
                    </td>
                  ) : null}
                  {valueIndex === 0 ? (
                    <td className="min-w-36 px-3 py-2 align-top" rowSpan={entry.values.length}>
                      <div
                        className={
                          entry.entry?.createdByEmployeeNameSnapshot
                            ? 'text-emerald-100'
                            : 'text-amber-100'
                        }
                      >
                        測定者 {entry.entry?.createdByEmployeeNameSnapshot ?? '未登録'}
                      </div>
                      <div
                        className={
                          entry.entry?.updatedAt ? 'text-xs text-white/55' : 'text-xs text-amber-100'
                        }
                      >
                        保存 {entry.entry?.updatedAt ? formatDateTime(entry.entry.updatedAt) : '未保存'}
                      </div>
                      {instrumentUsages.length > 0 ? (
                        <div className="mt-1 grid gap-0.5 text-emerald-100">
                          <div>オペレータ使用前点検済</div>
                          {instrumentUsages.map((usage) => (
                            <div key={usage.id} className="max-w-52 truncate text-xs text-emerald-100/85">
                              {formatInstrumentUsageLabel(usage)}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div
                          className={
                            legacyInstrumentLabel
                              ? 'text-emerald-100'
                              : requireMeasuringInstrumentTag
                                ? 'text-amber-100'
                                : 'text-white/55'
                          }
                        >
                          使用前点検 {legacyInstrumentLabel ?? (requireMeasuringInstrumentTag ? '未点検' : '任意')}
                        </div>
                      )}
                      <div className="mt-2 border-t border-white/10 pt-2">
                        <div
                          className={
                            entry.inspectorEntry?.inspectorEmployeeNameSnapshot
                              ? 'text-sky-100'
                              : 'text-amber-100'
                          }
                        >
                          検査員 {entry.inspectorEntry?.inspectorEmployeeNameSnapshot ?? '未登録'}
                        </div>
                        <div
                          className={
                            entry.inspectorEntry?.updatedAt
                              ? 'text-xs text-white/55'
                              : 'text-xs text-amber-100'
                          }
                        >
                          保存{' '}
                          {entry.inspectorEntry?.updatedAt
                            ? formatDateTime(entry.inspectorEntry.updatedAt)
                            : '未保存'}
                        </div>
                        {inspectorInstrumentUsages.length > 0 ? (
                          <div className="mt-1 grid gap-0.5 text-sky-100">
                            <div>検査員使用前点検済</div>
                            {inspectorInstrumentUsages.map((usage) => (
                              <div key={usage.id} className="max-w-52 truncate text-xs text-sky-100/85">
                                {formatInstrumentUsageLabel(usage)}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div
                            className={
                              inspectorLegacyInstrumentLabel
                                ? 'text-sky-100'
                                : requireMeasuringInstrumentTag
                                  ? 'text-amber-100'
                                  : 'text-white/55'
                            }
                          >
                            検査員使用前点検{' '}
                            {inspectorLegacyInstrumentLabel ??
                              (requireMeasuringInstrumentTag ? '未点検' : '任意')}
                          </div>
                        )}
                      </div>
                    </td>
                  ) : null}
                  <td className="px-3 py-2">{value.displayMarker ?? '-'}</td>
                  <td className="px-3 py-2">
                    <div className="font-semibold">{value.measurementLabel}</div>
                    <div className="text-xs text-white/50">{value.measurementPoint}</div>
                  </td>
                  <td
                    className={clsx(
                      'px-3 py-2 font-mono',
                      outOfTolerance ? 'text-red-100' : missing ? 'text-amber-100' : 'text-white'
                    )}
                  >
                    {operatorDisplay}
                    {!isJudgement && value.value && value.unit ? ` ${value.unit}` : ''}
                  </td>
                  <td
                    className={clsx(
                      'px-3 py-2 font-mono',
                      (isJudgement ? value.inspectorJudgementResult : value.inspectorValue) == null
                        ? 'text-amber-100'
                        : 'text-sky-100'
                    )}
                  >
                    {inspectorDisplay}
                    {!isJudgement && value.inspectorValue && value.unit ? ` ${value.unit}` : ''}
                  </td>
                  <td className="px-3 py-2 font-mono text-white/75">
                    {isJudgement ? '—' : value.differenceValue ?? '-'}
                  </td>
                  <td className="px-3 py-2 text-white/75">
                    {inspectorJudgementLabel(value.inspectorJudgementStatus)}
                  </td>
                  <td className="px-3 py-2 font-mono text-white/75">
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
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold">{selectedSession.productNo}</h2>
                <span
                  className={clsx(
                    'rounded px-2 py-1 text-xs font-semibold',
                    stateClassName(selectedSession.recordApprovalState)
                  )}
                >
                  {stateLabel(selectedSession.recordApprovalState)}
                </span>
              </div>
              <p className="text-sm text-white/65">
                {selectedSession.fhincd} / {selectedSession.fhinmei} / 資源 {selectedSession.resourceCd}
                {selectedSession.fseiban ? ` / 製番 ${selectedSession.fseiban}` : ''}
              </p>
              <p className="text-sm font-semibold text-white/75">
                {stateIntentLabel(selectedSession.recordApprovalState)}
              </p>
              <p className="text-xs text-white/50">
                入力 {selectedSession.completedRequiredEntryCount}/{selectedSession.requiredEntryCount}件
                {selectedSession.decisionWorkflow === 'INSPECTOR_FINAL_JUDGEMENT'
                  ? ` / 最終判定待ち ${selectedSession.pendingReviewCount}点`
                  : ` / 公差外承認待ち ${selectedSession.pendingReviewCount}点`}
                {selectedSession.recordApproval
                  ? ` / 承認 ${formatDateTime(selectedSession.recordApproval.approvedAt)} ${selectedSession.recordApproval.approverEmployeeNameSnapshot}`
                  : ''}
              </p>
              <p className="text-xs text-white/50">
                更新 {formatDateTime(selectedSession.updatedAt)} / 入力者{' '}
                {formatParticipantNames(selectedSession.participantEmployeeNames)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to={kioskSelfInspectionSessionPath(selectedSession.id)}
                className={buttonClassName('ghostOnDark', 'inline-flex items-center justify-center')}
              >
                入力画面
              </Link>
              <Link
                to={kioskSelfInspectionInspectorSessionPath(selectedSession.id)}
                className={buttonClassName('secondary', 'inline-flex items-center justify-center')}
              >
                検査員画面
              </Link>
            </div>
          </div>

          {selectedSession.decisionWorkflow === 'INSPECTOR_FINAL_JUDGEMENT' ? (
            <div className="grid gap-2 rounded border border-cyan-300/20 bg-cyan-500/10 p-3 md:grid-cols-[1fr_auto]">
              <div>
                <p className="text-sm font-semibold text-cyan-100">検査員最終判定フロー（閲覧専用）</p>
                <p className="mt-1 text-xs text-white/65">
                  この画面では作業者・検査員の入力結果を変更しません。必要な測定・最終判定・確定は検査員画面で行います。
                </p>
              </div>
              {getInspectorWorkflowAction(selectedSession) ? (
                <Link
                  to={getInspectorWorkflowAction(selectedSession)!.href}
                  className={buttonClassName('secondary', 'inline-flex min-w-44 items-center justify-center self-end')}
                >
                  {getInspectorWorkflowAction(selectedSession)!.label}
                </Link>
              ) : (
                <span className="self-end rounded bg-emerald-400/20 px-3 py-2 text-sm font-semibold text-emerald-100">
                  最終確定済み
                </span>
              )}
            </div>
          ) : (
            <ApprovalPanel operation={approval} />
          )}

          <DetailTable
            session={selectedSession}
            requireMeasuringInstrumentTag={requireMeasuringInstrumentTag}
          />
        </>
      )}
    </section>
  );
}
