import clsx from 'clsx';

import {
  formatDateTime,
  formatParticipantNames,
  INVALIDATION_STATE_LABELS,
  stateClassName,
  stateIntentLabel,
  stateLabel,
  truncatedResultsMessage,
  type SelfInspectionRecordApprovalFilter
} from './selfInspectionRecordApprovalViewModel';

import type {
  SelfInspectionItemInvalidationDto,
  SelfInspectionRecordApprovalSessionListItemDto
} from '../types';

type SelfInspectionRecordApprovalListProps = {
  filter: SelfInspectionRecordApprovalFilter;
  sessions: SelfInspectionRecordApprovalSessionListItemDto[];
  invalidations: SelfInspectionItemInvalidationDto[];
  selectedId: string | null;
  sessionsLoading: boolean;
  invalidationsLoading: boolean;
  truncated: boolean;
  onSelect: (id: string) => void;
};

function SessionListItem({
  session,
  selected,
  onSelect
}: {
  session: SelfInspectionRecordApprovalSessionListItemDto;
  selected: boolean;
  onSelect: () => void;
}) {
  const intent = stateIntentLabel(session.recordApprovalState);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={clsx(
        'grid w-full gap-1 rounded border p-3 text-left transition-colors',
        selected
          ? 'border-sky-300 bg-sky-500/15'
          : 'border-white/15 bg-slate-900/80 hover:border-white/35 hover:bg-slate-800'
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-bold">{session.productNo}</p>
          <p className="line-clamp-2 text-xs text-white/65">
            {session.fhincd} / {session.fhinmei} / 資源 {session.resourceCd}
          </p>
          {session.fseiban ? <p className="text-xs text-white/50">製番 {session.fseiban}</p> : null}
        </div>
        <span
          className={clsx(
            'shrink-0 rounded px-2 py-1 text-xs font-semibold',
            stateClassName(session.recordApprovalState)
          )}
        >
          {stateLabel(session.recordApprovalState)}
        </span>
      </div>
      {intent ? <p className="text-xs font-semibold text-white/70">{intent}</p> : null}
      <p className="text-xs text-white/55">
        入力 {session.completedRequiredEntryCount}/{session.requiredEntryCount}件
        {session.inspectorMissingRequiredEntryCount > 0 || session.inspectorIncompleteValueEntryCount > 0
          ? ` / 検査員 ${session.inspectorCompletedRequiredEntryCount}/${session.requiredEntryCount}件`
          : session.inspectorCompletedRequiredEntryCount > 0
            ? ` / 検査員 ${session.inspectorCompletedRequiredEntryCount}/${session.requiredEntryCount}件`
            : ''}
        {session.incompleteRegistrationEntryCount > 0
          ? ` / 点検不足 ${session.incompleteRegistrationEntryCount}件`
          : ''}
        {session.inspectorIncompleteRegistrationEntryCount > 0
          ? ` / 検査員点検不足 ${session.inspectorIncompleteRegistrationEntryCount}件`
          : ''}
        {session.pendingReviewCount > 0
          ? ` / ${
              session.decisionWorkflow === 'INSPECTOR_FINAL_JUDGEMENT'
                ? '最終判定待ち'
                : '公差外'
            } ${session.pendingReviewCount}点`
          : ''}
      </p>
      <p className="text-xs text-white/55">
        更新 {formatDateTime(session.updatedAt)} / 入力者 {formatParticipantNames(session.participantEmployeeNames)}
      </p>
    </button>
  );
}

function InvalidationListItem({
  invalidation,
  selected,
  onSelect
}: {
  invalidation: SelfInspectionItemInvalidationDto;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={clsx(
        'grid w-full gap-1 rounded border p-3 text-left transition-colors',
        selected
          ? 'border-rose-300 bg-rose-500/15'
          : 'border-white/15 bg-slate-900/80 hover:border-white/35 hover:bg-slate-800'
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-bold">{invalidation.productNoSnapshot}</p>
          <p className="line-clamp-2 text-xs text-white/65">
            {invalidation.fhincdSnapshot} / {invalidation.fhinmeiSnapshot} / 資源{' '}
            {invalidation.resourceCdSnapshot}
          </p>
        </div>
        <span className="shrink-0 rounded bg-rose-500/20 px-2 py-1 text-xs font-semibold text-rose-100">
          削除済み
        </span>
      </div>
      <p className="line-clamp-2 text-xs text-rose-100/85">{invalidation.reason}</p>
      <p className="text-xs text-white/55">
        {formatDateTime(invalidation.invalidatedAt)} / 削除前{' '}
        {INVALIDATION_STATE_LABELS[invalidation.sourceState]}
      </p>
    </button>
  );
}

export function SelfInspectionRecordApprovalList({
  filter,
  sessions,
  invalidations,
  selectedId,
  sessionsLoading,
  invalidationsLoading,
  truncated,
  onSelect
}: SelfInspectionRecordApprovalListProps) {
  const isInvalidated = filter === 'invalidated';
  const loading = isInvalidated ? invalidationsLoading : sessionsLoading;
  const hasItems = isInvalidated ? invalidations.length > 0 : sessions.length > 0;

  return (
    <aside
      className="min-h-0 overflow-auto rounded border border-white/15 bg-slate-950/45 p-2"
      aria-label={isInvalidated ? '削除履歴一覧' : '検査記録一覧'}
    >
      {truncated ? (
        <p className="mb-2 rounded border border-amber-300/30 bg-amber-500/10 px-2 py-2 text-xs text-amber-100">
          {truncatedResultsMessage()}
        </p>
      ) : null}
      {loading && !hasItems ? (
        <div className="py-10 text-center text-white/55">
          {isInvalidated ? '削除履歴を読込中...' : '読込中...'}
        </div>
      ) : !hasItems ? (
        <div className="py-10 text-center text-white/55">
          {isInvalidated ? '削除済みの自主検査はありません。' : '対象の検査記録はありません。'}
        </div>
      ) : (
        <div className="grid gap-2">
          {isInvalidated
            ? invalidations.map((invalidation) => (
                <InvalidationListItem
                  key={invalidation.id}
                  invalidation={invalidation}
                  selected={invalidation.id === selectedId}
                  onSelect={() => onSelect(invalidation.id)}
                />
              ))
            : sessions.map((session) => (
                <SessionListItem
                  key={session.id}
                  session={session}
                  selected={session.id === selectedId}
                  onSelect={() => onSelect(session.id)}
                />
              ))}
        </div>
      )}
    </aside>
  );
}
