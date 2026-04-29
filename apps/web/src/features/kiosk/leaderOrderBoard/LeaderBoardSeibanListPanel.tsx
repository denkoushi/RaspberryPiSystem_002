import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';

import { collectNextPrefixChars } from './collectSeibanPrefixCharset';
import {
  LEADER_BOARD_SEIBAN_PREFIX_MAX_LEN,
  appendLeaderBoardSeibanPrefixChar,
  clearLeaderBoardSeibanPrefix,
  formatLeaderBoardSeibanPrefixDisplayPadded,
  trimLastLeaderBoardSeibanPrefixChar
} from './leaderBoardSeibanPrefixFilterActions';
import { sortVisibleSeibanEntriesForDisplay } from './sortVisibleSeibanEntriesForDisplay';

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
  const [prefixFilter, setPrefixFilter] = useState('');

  const sortedEntries = useMemo(
    () => sortVisibleSeibanEntriesForDisplay(entries, registered),
    [entries, registered]
  );
  const filteredEntries = useMemo(
    () => sortedEntries.filter((e) => e.fseiban.startsWith(prefixFilter)),
    [sortedEntries, prefixFilter]
  );
  const charsetButtons = useMemo(
    () => collectNextPrefixChars(sortedEntries.map((e) => e.fseiban), prefixFilter),
    [prefixFilter, sortedEntries]
  );

  useEffect(() => {
    if (!isOpen) setPrefixFilter('');
  }, [isOpen]);

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
        className="relative flex h-full w-[min(100vw,84rem)] max-w-[92vw] flex-col border-l border-white/25 bg-slate-950 shadow-2xl"
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

        <div
          className="shrink-0 border-b border-white/10 px-4 py-3"
          aria-label="製番接頭辞フィルタ"
          role="region"
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="sr-only" aria-live="polite">
                  {prefixFilter.length > 0 ? `現在の接頭辞は ${prefixFilter} です` : '接頭辞は設定されていません'}
                </span>
                <span className="text-xs font-medium text-white/70">接頭辞:</span>
                <kbd
                  className="inline-flex min-h-[1.75rem] min-w-[9ch] items-center rounded border border-white/25 bg-slate-900 px-2 py-1 font-mono text-xl leading-none text-white"
                  aria-label={prefixFilter.length > 0 ? `現在の接頭辞 ${prefixFilter}` : '接頭辞は未設定'}
                >
                  {formatLeaderBoardSeibanPrefixDisplayPadded(prefixFilter)}
                </kbd>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={historyWriting || prefixFilter.length === 0}
                  aria-label="接頭辞の末尾を1文字削除"
                  className={clsx(
                    'rounded border px-3 py-1.5 text-sm font-medium transition-colors',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400/70',
                    prefixFilter.length === 0
                      ? 'cursor-not-allowed border-white/15 text-white/40'
                      : 'border-white/35 bg-slate-900 text-white hover:bg-slate-800',
                    historyWriting && 'cursor-wait opacity-70'
                  )}
                  onClick={() => setPrefixFilter((prev) => trimLastLeaderBoardSeibanPrefixChar(prev))}
                >
                  末尾削除
                </button>
                <button
                  type="button"
                  disabled={historyWriting || prefixFilter.length === 0}
                  aria-label="接頭辞フィルタをすべて解除"
                  className={clsx(
                    'rounded border px-3 py-1.5 text-sm font-medium transition-colors',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400/70',
                    prefixFilter.length === 0
                      ? 'cursor-not-allowed border-white/15 text-white/40'
                      : 'border-amber-400/60 bg-amber-950/50 text-amber-100 hover:bg-amber-900/50',
                    historyWriting && 'cursor-wait opacity-70'
                  )}
                  onClick={() => setPrefixFilter(() => clearLeaderBoardSeibanPrefix())}
                >
                  全解除
                </button>
              </div>
            </div>

            <div
              className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-4"
              aria-label="接頭辞に続く文字"
            >
              {charsetButtons.map((ch) => (
                <button
                  key={ch}
                  type="button"
                  disabled={historyWriting || prefixFilter.length >= LEADER_BOARD_SEIBAN_PREFIX_MAX_LEN}
                  aria-label={`接頭辞の末尾に「${ch}」を追加`}
                  title={`「${ch}」を追加`}
                  className={clsx(
                    'min-h-[2rem] min-w-[2rem] rounded-md border px-2 font-mono text-xl font-semibold text-white transition-colors',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400/70',
                    'border-cyan-500/45 bg-slate-900 hover:bg-slate-800',
                    (historyWriting || prefixFilter.length >= LEADER_BOARD_SEIBAN_PREFIX_MAX_LEN) &&
                      'cursor-not-allowed opacity-60'
                  )}
                  onClick={() =>
                    setPrefixFilter((prev) => appendLeaderBoardSeibanPrefixChar(prev, ch))
                  }
                >
                  {ch === ' ' ? '\u00a0' : ch}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4" style={{ WebkitOverflowScrolling: 'touch' }}>
          {filteredEntries.length === 0 ? (
            <p className="text-sm text-white/60">
              {entries.length === 0 ? '表示中の製番がありません。' : 'この接頭辞に一致する製番がありません。'}
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="leader-board-seiban-card-grid">
              {filteredEntries.map((entry) => {
                const isRegistered = registered.has(entry.fseiban);
                return (
                  <li key={entry.fseiban}>
                    <button
                      type="button"
                      disabled={historyWriting}
                      aria-pressed={isRegistered}
                      onClick={() => onToggle(entry.fseiban)}
                      className={clsx(
                        'flex w-full flex-col items-start rounded-lg border-2 px-3 py-3 text-left transition-colors',
                        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400/70',
                        isRegistered
                          ? 'border-slate-500/70 bg-slate-800/90 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.18)] hover:bg-slate-700/90'
                          : 'border-cyan-400/70 bg-slate-900 hover:bg-slate-800',
                        historyWriting && 'cursor-wait opacity-75'
                      )}
                    >
                      <span
                        className={clsx(
                          'font-mono text-lg font-bold leading-tight',
                          isRegistered ? 'text-slate-200' : 'text-white'
                        )}
                      >
                        {entry.fseiban}
                      </span>
                      <span
                        className={clsx(
                          'mt-1 line-clamp-2 text-base leading-snug',
                          isRegistered ? 'text-slate-300/95' : 'text-white/90'
                        )}
                      >
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
