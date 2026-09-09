import { useEffect, useMemo, useState } from 'react';

import { SeibanSearchRegister } from '../productionSchedule/SeibanSearchRegister';

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
  onRemove: (fseiban: string) => void;
  onToggle: (fseiban: string) => void;
  onClear: () => void;
  onMove: (fseiban: string, direction: 'up' | 'down') => void;
};

export function PlanningBoardSeibanDrawer({
  isOpen,
  registeredFseibans,
  selectedFseibans,
  machineNameBySeiban,
  onClose,
  onRegister,
  onRemove,
  onToggle,
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

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setRegistrationError(null);
    }
  }, [isOpen]);

  const visibleFseibans = useMemo(() => {
    const normalized = query.trim();
    return normalized.length === 0
      ? registeredFseibans
      : registeredFseibans.filter((fseiban) => fseiban.includes(normalized));
  }, [query, registeredFseibans]);

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
            <button
              type="button"
              className="min-h-11 rounded-md px-2 text-xs font-semibold text-slate-400 hover:bg-slate-900 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
              onClick={onClear}
              disabled={orderDisabled}
            >
              全て解除
            </button>
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
