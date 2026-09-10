import { useEffect, useMemo, useState } from 'react';

import { SeibanSearchRegister } from '../productionSchedule/SeibanSearchRegister';

import type {
  GrindingPlanningBoardSeibanCandidate,
  GrindingPlanningBoardSeibanCandidatesResponse
} from '@raspi-system/shared-types';

export type PlanningBoardSeibanDrawerProps = {
  isOpen: boolean;
  registeredFseibans: readonly string[];
  selectedFseibans: ReadonlySet<string>;
  machineNameBySeiban?: ReadonlyMap<string, string | null>;
  candidateData?: GrindingPlanningBoardSeibanCandidatesResponse;
  candidateFetching?: boolean;
  candidateError?: boolean;
  showCompletedCandidates: boolean;
  onShowCompletedCandidatesChange: (show: boolean) => void;
  onRegisterMany: (fseibans: readonly string[]) => Promise<boolean>;
  orderReadOnly?: boolean;
  orderBusy?: boolean;
  orderStatus?: string | null;
  registrationError?: string | null;
  onRefreshOrder?: () => void;
  onClose: () => void;
  onRegister: (fseiban: string) => Promise<boolean>;
  onRemove: (fseiban: string) => void;
  onToggle: (fseiban: string) => void;
  onOpenDueDetail: (fseiban: string) => void;
  dueDetailTargetFseiban?: string | null;
  onClear: () => void;
  onMove: (fseiban: string, direction: 'up' | 'down') => void;
};

export function PlanningBoardSeibanDrawer({
  isOpen,
  registeredFseibans,
  selectedFseibans,
  machineNameBySeiban,
  candidateData,
  candidateFetching = false,
  candidateError = false,
  showCompletedCandidates,
  onShowCompletedCandidatesChange,
  onRegisterMany,
  onClose,
  onRegister,
  onRemove,
  onToggle,
  onOpenDueDetail,
  dueDetailTargetFseiban,
  onClear,
  onMove,
  orderReadOnly = false,
  orderBusy = false,
  orderStatus = null,
  registrationError: externalRegistrationError = null,
  onRefreshOrder
}: PlanningBoardSeibanDrawerProps) {
  const [query, setQuery] = useState('');
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [candidateSeibanQuery, setCandidateSeibanQuery] = useState('');
  const [candidateMachineQuery, setCandidateMachineQuery] = useState('');
  const [selectedCandidates, setSelectedCandidates] = useState<ReadonlySet<string>>(new Set());
  const [collapsedMachineNames, setCollapsedMachineNames] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setRegistrationError(null);
      setCandidateSeibanQuery('');
      setCandidateMachineQuery('');
      setSelectedCandidates(new Set());
      setCollapsedMachineNames(new Set());
    }
  }, [isOpen]);

  const visibleFseibans = useMemo(() => {
    const normalized = query.trim();
    return normalized.length === 0
      ? registeredFseibans
      : registeredFseibans.filter((fseiban) => fseiban.includes(normalized));
  }, [query, registeredFseibans]);

  const candidateGroups = useMemo(() => {
    const seibanQuery = candidateSeibanQuery.trim().toLocaleLowerCase('ja');
    const machineQuery = candidateMachineQuery.trim().toLocaleLowerCase('ja');
    const groups = new Map<string, GrindingPlanningBoardSeibanCandidate[]>();
    for (const candidate of candidateData?.candidates ?? []) {
      const machineName = candidate.machineName || '機種名未登録';
      if (seibanQuery && !candidate.fseiban.toLocaleLowerCase('ja').includes(seibanQuery)) continue;
      if (machineQuery && !machineName.toLocaleLowerCase('ja').includes(machineQuery)) continue;
      const group = groups.get(machineName) ?? [];
      group.push(candidate);
      groups.set(machineName, group);
    }
    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'ja'))
      .map(([machineName, candidates]) => [
        machineName,
        candidates.sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.fseiban.localeCompare(right.fseiban, 'ja'))
      ] as const);
  }, [candidateData?.candidates, candidateMachineQuery, candidateSeibanQuery]);

  const visibleCandidateCount = candidateGroups.reduce((count, [, candidates]) => count + candidates.length, 0);
  const selectedCandidateCount = [...selectedCandidates].filter((fseiban) => !registeredFseibans.includes(fseiban)).length;

  const toggleCandidate = (fseiban: string) => {
    if (registeredFseibans.includes(fseiban) || orderDisabled) return;
    setSelectedCandidates((current) => {
      const next = new Set(current);
      if (next.has(fseiban)) next.delete(fseiban); else next.add(fseiban);
      return next;
    });
  };

  const registerSelectedCandidates = async () => {
    const values = [...selectedCandidates].filter((fseiban) => !registeredFseibans.includes(fseiban));
    if (values.length === 0) return;
    const saved = await onRegisterMany(values);
    if (saved) setSelectedCandidates(new Set());
    else setRegistrationError('選択した製番を登録できませんでした。登録上限・重複・通信状態を確認してください。');
  };

  const formatCandidateDate = (value: string): string => value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1/$2/$3');

  if (!isOpen) return null;

  const orderDisabled = orderReadOnly || orderBusy;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/65" role="presentation" onClick={onClose} />
      <aside
        className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,92vw)] flex-col border-r border-slate-700 bg-slate-950 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="planning-board-seiban-drawer-title"
      >
        <header className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-800 px-3">
          <h2 id="planning-board-seiban-drawer-title" className="text-sm font-bold text-white">製番登録</h2>
          <button
            type="button"
            className="grid min-h-11 min-w-11 place-items-center rounded-md text-lg text-slate-300 hover:bg-slate-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
            aria-label="製番登録ペインを閉じる"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <section aria-labelledby="planning-board-seiban-candidate-title" className="mb-5 rounded-lg border border-slate-800 bg-slate-900/50 p-2">
            <div className="flex items-center justify-between gap-2">
              <h3 id="planning-board-seiban-candidate-title" className="text-xs font-bold text-white">納期範囲の候補</h3>
              {candidateFetching ? <span className="text-[10px] text-cyan-300" role="status">更新中…</span> : null}
            </div>
            <p className="mt-1 text-[10px] leading-4 text-slate-400">
              {candidateData ? `${formatCandidateDate(candidateData.rangeStart)}〜${formatCandidateDate(candidateData.rangeEnd)}（今日: ${formatCandidateDate(candidateData.today)}）` : '候補を読み込んでいます…'}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <input
                type="search"
                value={candidateSeibanQuery}
                onChange={(event) => setCandidateSeibanQuery(event.target.value)}
                placeholder="製番で絞り込み"
                aria-label="候補を製番で絞り込み"
                className="min-h-10 min-w-0 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-white outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
              />
              <input
                type="search"
                value={candidateMachineQuery}
                onChange={(event) => setCandidateMachineQuery(event.target.value)}
                placeholder="機種名で絞り込み"
                aria-label="候補を機種名で絞り込み"
                className="min-h-10 min-w-0 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-white outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
              />
            </div>
            <label className="mt-2 flex min-h-9 items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={showCompletedCandidates}
                onChange={(event) => onShowCompletedCandidatesChange(event.target.checked)}
                disabled={orderReadOnly}
                className="h-4 w-4 accent-cyan-400"
              />
              完了分も表示
            </label>
            {candidateError && !candidateData ? <p className="mt-2 text-xs text-rose-300" role="alert">候補を取得できませんでした。</p> : null}
            {candidateData && visibleCandidateCount === 0 ? <p className="mt-2 text-xs text-slate-500">条件に一致する候補がありません。</p> : null}
            {candidateGroups.map(([machineName, candidates]) => {
              const collapsed = collapsedMachineNames.has(machineName);
              return (
                <div key={machineName} className="mt-2 overflow-hidden rounded-md border border-slate-800">
                  <button
                    type="button"
                    className="flex min-h-10 w-full items-center justify-between gap-2 bg-slate-800 px-2 text-left text-xs font-semibold text-slate-200 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
                    aria-expanded={!collapsed}
                    onClick={() => setCollapsedMachineNames((current) => {
                      const next = new Set(current);
                      if (next.has(machineName)) next.delete(machineName); else next.add(machineName);
                      return next;
                    })}
                  >
                    <span className="truncate">{machineName}（{candidates.length}）</span>
                    <span aria-hidden="true">{collapsed ? '＋' : '－'}</span>
                  </button>
                  {!collapsed ? (
                    <div className="divide-y divide-slate-800">
                      {candidates.map((candidate) => {
                        const registered = registeredFseibans.includes(candidate.fseiban);
                        const checked = selectedCandidates.has(candidate.fseiban);
                        const overdue = candidate.dueDate < (candidateData?.today ?? '');
                        return (
                          <label key={candidate.fseiban} className={`flex min-h-12 items-center gap-2 px-2 py-1.5 ${registered ? 'opacity-50' : 'hover:bg-slate-800/70'}`}>
                            <input
                              type="checkbox"
                              checked={registered || checked}
                              disabled={registered || orderDisabled}
                              onChange={() => toggleCandidate(candidate.fseiban)}
                              className="h-4 w-4 shrink-0 accent-emerald-400"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5 text-xs font-bold text-slate-100">
                                <span className="truncate font-mono">{candidate.fseiban}</span>
                                {registered ? <span className="shrink-0 text-[10px] text-emerald-300">登録済</span> : null}
                              </span>
                              <span className={`block text-[10px] ${overdue ? 'font-bold text-rose-300' : 'text-slate-400'}`}>
                                納期 {formatCandidateDate(candidate.dueDate)}{overdue ? '・期限超過' : ''} ／ 完了 {candidate.completedProcessCount}/{candidate.totalProcessCount}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <button
              type="button"
              className="mt-2 min-h-11 w-full rounded-md bg-cyan-400 px-2 text-xs font-bold text-slate-950 hover:bg-cyan-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:opacity-50"
              disabled={orderDisabled || selectedCandidateCount === 0}
              onClick={() => void registerSelectedCandidates()}
            >
              選択した製番を登録{selectedCandidateCount > 0 ? `（${selectedCandidateCount}件）` : ''}
            </button>
          </section>
          <SeibanSearchRegister
            value={query}
            onChange={(value) => {
              setQuery(value);
              setRegistrationError(null);
            }}
            onRegister={async (value) => {
              const saved = await onRegister(value);
              if (!saved) setRegistrationError('製番を登録できませんでした。入力値・重複・登録上限を確認してください。');
              return saved;
            }}
            inputPlaceholder="例：26-1041"
            inputType="search"
            inputDisabled={orderReadOnly}
            registerDisabled={orderDisabled}
            clearOnSuccess
            error={externalRegistrationError || registrationError ? (
              <div className="mt-1 flex items-start justify-between gap-2 text-xs text-rose-300" role="alert">
                <span>{externalRegistrationError || registrationError}</span>
                {onRefreshOrder ? <button type="button" className="min-h-9 shrink-0 rounded border border-rose-300/50 px-2 text-rose-200 hover:bg-rose-950/60" onClick={onRefreshOrder}>最新状態を取得</button> : null}
              </div>
            ) : null}
            inputClassName="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 text-sm text-white outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20"
            keyboardButtonClassName="min-h-11 shrink-0 rounded-md border border-slate-700 bg-slate-900 px-2 text-xs font-semibold text-slate-300 hover:border-emerald-300 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
            registerButtonClassName="min-h-11 shrink-0 rounded-md bg-emerald-400 px-3 text-xs font-bold text-slate-950 hover:bg-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
          />
          {orderStatus ? <p className="mt-2 text-xs text-slate-400" role="status">{orderStatus}</p> : null}
          <div className="mt-4 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-300">登録製番（OR）</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="min-h-11 rounded-md px-2 text-xs font-semibold text-cyan-300 hover:bg-slate-900 hover:text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:opacity-50"
                onClick={() => {
                  if (dueDetailTargetFseiban) onOpenDueDetail(dueDetailTargetFseiban);
                }}
                disabled={!dueDetailTargetFseiban}
                aria-label={dueDetailTargetFseiban ? `製番${dueDetailTargetFseiban}の納期詳細を開く` : '納期詳細を開く（製番未選択）'}
              >
                納期詳細{dueDetailTargetFseiban ? `: ${dueDetailTargetFseiban}` : ''}
              </button>
              <button
                type="button"
                className="min-h-11 rounded-md px-2 text-xs font-semibold text-slate-400 hover:bg-slate-900 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
                onClick={onClear}
                disabled={orderDisabled}
              >
                全て解除
              </button>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {visibleFseibans.map((fseiban) => {
              const selected = selectedFseibans.has(fseiban);
              return (
                <div key={fseiban} className="grid min-w-0 grid-cols-[minmax(0,1fr)_2.25rem] gap-0.5">
                  <button
                    type="button"
                    aria-pressed={selected}
                    className={`min-h-11 min-w-0 overflow-hidden rounded-md border px-2 text-left font-mono text-xs font-bold ${
                      selected
                        ? 'border-emerald-400 bg-emerald-400 text-slate-950'
                        : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-emerald-300'
                    }`}
                    disabled={orderDisabled}
                    onClick={() => onToggle(fseiban)}
                  >
                    <span className="block truncate">{fseiban}</span>
                    <span className="block truncate text-[9px] font-normal opacity-70">{machineNameBySeiban?.get(fseiban) || '機種名未登録'}</span>
                  </button>
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      className="min-h-5 flex-1 rounded bg-slate-900 text-xs text-slate-400 hover:bg-slate-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
                      aria-label={`製番${fseiban}を上へ`}
                      disabled={orderDisabled}
                      onClick={() => onMove(fseiban, 'up')}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="min-h-5 flex-1 rounded bg-slate-900 text-xs text-slate-400 hover:bg-slate-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
                      aria-label={`製番${fseiban}を下へ`}
                      disabled={orderDisabled}
                      onClick={() => onMove(fseiban, 'down')}
                    >
                      ↓
                    </button>
                  </div>
                  <button
                    type="button"
                    className="col-span-2 min-h-6 rounded text-[10px] text-slate-500 hover:bg-slate-900 hover:text-white"
                    aria-label={`製番${fseiban}の登録を解除`}
                    disabled={orderDisabled}
                    onClick={() => onRemove(fseiban)}
                  >
                    登録解除
                  </button>
                </div>
              );
            })}
          </div>
          {visibleFseibans.length === 0 ? <p className="mt-4 text-xs text-slate-500">登録製番がありません。</p> : null}
        </div>
      </aside>
    </>
  );
}
