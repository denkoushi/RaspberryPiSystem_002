import clsx from 'clsx';
import { useEffect, useMemo } from 'react';

import type { VisibleSeibanEntry } from './deriveVisibleSeibanEntries';

export type LeaderBoardSeibanListPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  entries: readonly VisibleSeibanEntry[];
  /** `normalizeHistoryList` 済みと同等の共有製番履歴（順序は問わない） */
  sharedHistory: readonly string[];
  historyWriting: boolean;
  onToggle: (fseiban: string) => void;
};

/**
 * 表示中製番を一覧し、共有製番履歴への登録をトグルするハーフスクリーンオーバーレイ。
 * API に依存しない（親からイベントのみ受け取る）。
 */
export function LeaderBoardSeibanListPanel({
  isOpen,
  onClose,
  entries,
  sharedHistory,
  historyWriting,
  onToggle
}: LeaderBoardSeibanListPanelProps) {
  const registered = useMemo(() => new Set(sharedHistory.map((s) => s.trim()).filter(Boolean)), [sharedHistory]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[85] flex justify-end" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/65"
        aria-label="製番一覧を閉じる"
        onClick={onClose}
      />
      <aside
        className="relative flex h-full w-[min(50vw,42rem)] max-w-[92vw] flex-col border-l border-white/15 bg-slate-950 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="leader-board-seiban-list-title"
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/15 px-4 py-3">
          <h2 id="leader-board-seiban-list-title" className="text-base font-semibold text-white">
            製番一覧（表示中）
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-white/25 px-3 py-1.5 text-sm text-white/90 hover:bg-white/10"
          >
            閉じる
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4" style={{ WebkitOverflowScrolling: 'touch' }}>
          {entries.length === 0 ? (
            <p className="text-sm text-white/60">表示中の製番がありません。</p>
          ) : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {entries.map((entry) => {
                const isRegistered = registered.has(entry.fseiban);
                return (
                  <li key={entry.fseiban}>
                    <button
                      type="button"
                      disabled={historyWriting}
                      aria-pressed={isRegistered}
                      onClick={() => onToggle(entry.fseiban)}
                      className={clsx(
                        'flex w-full flex-col items-start rounded-lg border px-3 py-3 text-left transition-colors',
                        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400/70',
                        isRegistered
                          ? 'border-white/15 bg-white/5 opacity-60 hover:bg-white/10'
                          : 'border-cyan-400/35 bg-slate-900/90 hover:bg-slate-800/90',
                        historyWriting && 'cursor-wait opacity-70'
                      )}
                    >
                      <span className="font-mono text-lg font-bold leading-tight text-white">{entry.fseiban}</span>
                      <span className="mt-1 line-clamp-2 text-base leading-snug text-white/85">
                        {entry.machineName.length > 0 ? entry.machineName : '—'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
