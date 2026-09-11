import { useEffect, useMemo, useState } from 'react';

import { matchesDigitQuery } from '../../part-measurement/inspection-drawing';
import { KioskDigitTenkey } from '../KioskDigitTenkey';
import { normalizeMachineName } from '../productionSchedule/machineName';
import { SeibanSearchRegister } from '../productionSchedule/SeibanSearchRegister';

import type { GrindingPlanningBoardSeibanCandidate } from '@raspi-system/shared-types';

const REGISTERED_SEIBAN_MAX = 50;
const UNSET_MACHINE_NAME = '未設定';

function formatCandidateDate(value: string): string {
  return value.slice(5).replace('-', '/');
}

function isCandidateOverdue(candidate: GrindingPlanningBoardSeibanCandidate, today: string): boolean {
  return candidate.dueDate < today;
}

function normalizeCandidateMachineName(value: string | null | undefined): string {
  return normalizeMachineName(value, { maxChars: Number.MAX_SAFE_INTEGER });
}

export type PlanningBoardSeibanDrawerProps = {
  isOpen: boolean;
  registeredFseibans: readonly string[];
  selectedFseibans: ReadonlySet<string>;
  machineNameBySeiban?: ReadonlyMap<string, string | null>;
  orderReadOnly?: boolean;
  orderBusy?: boolean;
  orderStatus?: string | null;
  registrationError?: string | null;
  onRefreshOrder?: () => void;
  onClose: () => void;
  onRegister: (fseiban: string) => Promise<boolean>;
  onRegisterMany: (fseibans: readonly string[]) => Promise<boolean>;
  onRemove: (fseiban: string) => void;
  onToggle: (fseiban: string) => void;
  onOpenDueDetail: (fseiban: string) => void;
  dueDetailTargetFseiban?: string | null;
  onClear: () => void;
  onMove: (fseiban: string, direction: 'up' | 'down') => void;
  candidates?: readonly GrindingPlanningBoardSeibanCandidate[];
  candidatesToday?: string;
  candidatesRangeStart?: string;
  candidatesRangeEnd?: string;
  candidatesLoading?: boolean;
  candidatesError?: boolean;
  candidateScopeKey?: string;
  showCompletedCandidates: boolean;
  onShowCompletedCandidatesChange: (show: boolean) => void;
};

export function PlanningBoardSeibanDrawer({
  isOpen,
  registeredFseibans,
  selectedFseibans,
  machineNameBySeiban,
  onClose,
  onRegister,
  onRegisterMany,
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
  onRefreshOrder,
  candidates = [],
  candidatesToday,
  candidatesLoading = false,
  candidatesError = false,
  candidateScopeKey,
  showCompletedCandidates,
  onShowCompletedCandidatesChange
}: PlanningBoardSeibanDrawerProps) {
  const [query, setQuery] = useState('');
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [selectedCandidates, setSelectedCandidates] = useState<ReadonlySet<string>>(new Set());
  const [collapsedMachineNames, setCollapsedMachineNames] = useState<ReadonlySet<string>>(new Set());
  const [machineNameDigitQuery, setMachineNameDigitQuery] = useState('');
  const orderDisabled = orderReadOnly || orderBusy;

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setRegistrationError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedCandidates(new Set());
  }, [candidateScopeKey]);

  const visibleFseibans = useMemo(() => {
    const normalized = query.trim();
    return normalized.length === 0
      ? registeredFseibans
      : registeredFseibans.filter((fseiban) => fseiban.includes(normalized));
  }, [query, registeredFseibans]);

  const visibleCandidates = useMemo(() => {
    const normalized = normalizeCandidateMachineName(query).toLocaleLowerCase();
    return candidates.filter((candidate) => {
      if (!showCompletedCandidates && candidate.isCompleted) return false;
      if (!matchesDigitQuery(normalizeCandidateMachineName(candidate.machineName), machineNameDigitQuery)) return false;
      if (normalized.length === 0) return true;
      return candidate.fseiban.toLocaleLowerCase().includes(normalized) ||
        normalizeCandidateMachineName(candidate.machineName).toLocaleLowerCase().includes(normalized);
    });
  }, [candidates, machineNameDigitQuery, query, showCompletedCandidates]);

  const candidateGroups = useMemo(() => {
    const groups = new Map<string, GrindingPlanningBoardSeibanCandidate[]>();
    for (const candidate of visibleCandidates) {
      const machineName = normalizeCandidateMachineName(candidate.machineName) || UNSET_MACHINE_NAME;
      const group = groups.get(machineName) ?? [];
      group.push(candidate);
      groups.set(machineName, group);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'ja'));
  }, [visibleCandidates]);

  const selectedCandidatesForRegistration = candidates.filter((candidate) =>
    selectedCandidates.has(candidate.fseiban) &&
    (!candidate.isCompleted || showCompletedCandidates) &&
    !registeredFseibans.includes(candidate.fseiban)
  );
  const selectedCandidateCount = selectedCandidatesForRegistration.length;
  const availableSlots = REGISTERED_SEIBAN_MAX - registeredFseibans.length;
  const selectedWouldExceedLimit = selectedCandidateCount > availableSlots;

  const toggleCandidate = (fseiban: string, selected: boolean) => {
    setSelectedCandidates((current) => {
      const next = new Set(current);
      if (selected) next.add(fseiban); else next.delete(fseiban);
      return next;
    });
  };

  const registerSelectedCandidates = async () => {
    if (selectedCandidateCount === 0 || selectedWouldExceedLimit || orderDisabled) return;
    const fseibans = selectedCandidatesForRegistration.map((candidate) => candidate.fseiban);
    const saved = await onRegisterMany(fseibans);
    if (saved) {
      setSelectedCandidates((current) => {
        const next = new Set(current);
        for (const fseiban of fseibans) next.delete(fseiban);
        return next;
      });
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/65" role="presentation" onClick={onClose} />
      <aside
        className="fixed inset-y-0 left-0 z-50 flex w-[min(40rem,92vw)] flex-col border-r border-slate-700 bg-slate-950 shadow-2xl"
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
          <section className="mt-4 rounded-md border border-slate-800 bg-slate-900/70 p-2" aria-label="納期候補">
            <div className="flex items-start justify-between gap-2">
              <label className="flex min-h-11 shrink-0 items-center gap-1 text-[10px] text-slate-300">
                <input
                  type="checkbox"
                  className="accent-emerald-400"
                  checked={showCompletedCandidates}
                  onChange={(event) => onShowCompletedCandidatesChange(event.target.checked)}
                />
                完了表示
              </label>
            </div>
            <div className="mt-2 flex min-w-0 items-center gap-1 rounded border border-slate-800 bg-slate-950/80 px-1 py-1" data-testid="planning-board-machine-name-search">
              <span
                className="min-w-0 max-w-28 flex-1 truncate rounded border border-slate-700 bg-slate-900 px-2 text-center font-mono text-sm text-white"
                aria-label="機種名数字検索値"
              >
                {machineNameDigitQuery || '—'}
              </span>
              <KioskDigitTenkey
                value={machineNameDigitQuery}
                onChange={setMachineNameDigitQuery}
                disabled={orderDisabled}
                maxLength={200}
                ariaLabel="機種名数字テンキー"
                showReset={false}
                className="flex shrink-0 flex-nowrap items-center justify-center gap-0.5"
                keyClassName="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded border border-white/15 bg-slate-950 text-[0.82rem] font-extrabold text-white hover:bg-slate-800 disabled:opacity-50"
              />
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  className="inline-flex h-[34px] w-[34px] items-center justify-center rounded border border-white/15 bg-slate-950 text-base font-extrabold text-white hover:bg-slate-800 disabled:opacity-50"
                  aria-label="機種名数字を1文字削除"
                  disabled={orderDisabled || machineNameDigitQuery.length === 0}
                  onClick={() => setMachineNameDigitQuery((current) => current.slice(0, -1))}
                >
                  ⌫
                </button>
                <button
                  type="button"
                  className="inline-flex h-[34px] w-[34px] items-center justify-center rounded border border-amber-300/30 bg-slate-950 text-base font-extrabold text-amber-200 hover:bg-slate-800 disabled:opacity-50"
                  aria-label="機種名数字をリセット"
                  disabled={orderDisabled || machineNameDigitQuery.length === 0}
                  onClick={() => setMachineNameDigitQuery('')}
                >
                  ↺
                </button>
              </div>
            </div>
            {selectedCandidateCount > 0 ? (
              <div className="mt-2 rounded border border-emerald-400/40 bg-emerald-950/40 p-2">
                <div className="grid grid-cols-2 gap-0.5 text-xs text-emerald-100">
                  {selectedCandidatesForRegistration.map((candidate) => (
                    <div key={candidate.fseiban} className="min-w-0 truncate">
                      {candidate.fseiban} · {normalizeCandidateMachineName(candidate.machineName) || '機種名未登録'}
                    </div>
                  ))}
                </div>
                <div className="mt-1 text-[10px] text-emerald-200/80">登録残り {Math.max(availableSlots, 0)}件</div>
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    className="min-h-11 shrink-0 whitespace-nowrap rounded bg-emerald-400 px-3 text-xs font-bold text-slate-950 hover:bg-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="選択した製番を登録"
                    disabled={orderDisabled || selectedWouldExceedLimit}
                    onClick={() => void registerSelectedCandidates()}
                  >
                    登録
                  </button>
                </div>
                {selectedWouldExceedLimit ? (
                  <p className="mt-1 text-[10px] text-amber-200" role="alert">登録上限50件を超えるため登録できません。選択を減らしてください。</p>
                ) : null}
              </div>
            ) : null}
            {candidatesLoading && candidates.length === 0 ? <p className="mt-2 text-xs text-slate-500">候補を取得中…</p> : null}
            {candidatesError ? <p className="mt-2 text-xs text-rose-300" role="alert">候補を取得できませんでした。再試行します。</p> : null}
            {!candidatesLoading && !candidatesError && candidateGroups.length === 0 ? <p className="mt-2 text-xs text-slate-500">該当する候補はありません。</p> : null}
            <div className="mt-2 grid max-h-[min(42vh,28rem)] grid-cols-2 items-start gap-1.5 overflow-y-auto pr-1">
              {candidateGroups.map(([machineName, group]) => {
                const collapsed = collapsedMachineNames.has(machineName);
                return (
                  <div key={machineName} className="rounded border border-slate-800 bg-slate-950/80">
                    <button
                      type="button"
                      className="flex min-h-11 w-full items-center justify-between gap-2 px-2 text-left text-xs font-semibold text-slate-200"
                      aria-expanded={!collapsed}
                      aria-label={`機種名${machineName}の候補を${collapsed ? '開く' : '閉じる'}`}
                      onClick={() => setCollapsedMachineNames((current) => {
                        const next = new Set(current);
                        if (next.has(machineName)) next.delete(machineName); else next.add(machineName);
                        return next;
                      })}
                    >
                      <span className="truncate" title={machineName}>{machineName}</span>
                      <span className="shrink-0 text-[10px] text-slate-500">{group.length}件 {collapsed ? '▸' : '▾'}</span>
                    </button>
                    {!collapsed ? (
                      <div className="grid grid-cols-2 gap-1 border-t border-slate-800 p-1.5">
                        {group.map((candidate) => {
                          const registered = registeredFseibans.includes(candidate.fseiban);
                          const selected = selectedCandidates.has(candidate.fseiban);
                          const overdue = candidatesToday ? isCandidateOverdue(candidate, candidatesToday) : false;
                          return (
                            <label
                              key={candidate.fseiban}
                              className={`grid min-h-11 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 rounded border px-2 ${
                                registered ? 'border-slate-800 bg-slate-900/50 opacity-70' : selected ? 'border-emerald-400/60 bg-emerald-950/40' : 'border-slate-800 bg-slate-900'
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 shrink-0 accent-emerald-400"
                                checked={registered || selected}
                                disabled={registered || orderDisabled}
                                onChange={(event) => toggleCandidate(candidate.fseiban, event.target.checked)}
                                aria-label={`${candidate.fseiban}を登録候補に選択`}
                              />
                              <span className="min-w-0">
                                <span className="block truncate font-mono text-xs font-bold text-white">{candidate.fseiban}</span>
                                <span className={`block text-[10px] ${overdue ? 'font-bold text-rose-300' : 'text-slate-400'}`}>
                                  {formatCandidateDate(candidate.dueDate)}
                                  <span className={`font-semibold ${registered ? 'text-cyan-300' : 'text-slate-500'}`}>
                                    ・{registered ? '登録済み' : candidate.isCompleted ? '完了' : '未登録'}
                                  </span>
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
            </div>
          </section>
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
          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
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
                    <span className="block truncate text-[9px] font-normal text-black">{normalizeCandidateMachineName(machineNameBySeiban?.get(fseiban)) || '機種名未登録'}</span>
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
