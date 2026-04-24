import clsx from 'clsx';

import { KIOSK_REVEAL_TRANSFORM_TRANSITION_CLASS } from '../../../hooks/kioskRevealUi';
import { KIOSK_LEFT_EDGE_HOT_ZONE_PX } from '../../../hooks/useKioskLeftEdgeDrawerReveal';

import { LeaderBoardDueAssistPanel } from './LeaderBoardDueAssistPanel';

import type { LeaderOrderCompletionFilter } from './filterLeaderBoardRowsByCompletion';
import type { LeaderBoardDueAssistHandle } from './useLeaderBoardDueAssist';
import type { LeaderOrderBoardDeviceCard } from './useLeaderOrderBoardDeviceContext';
import type { RefObject } from 'react';

export type LeaderBoardLeftToolStackProps = {
  leftToolStackOuterRef: RefObject<HTMLDivElement>;
  drawerReveal: {
    isVisible: boolean;
    onDrawerMouseEnter: () => void;
    onDrawerMouseLeave: () => void;
    onHotZoneEnter: () => void;
  };
  siteKey: string;
  defaultSites: readonly string[];
  handleSiteChange: (next: string) => void;
  activeDeviceScopeKey: string;
  setActiveDeviceScopeKey: (key: string) => void;
  setSelectedResourceCd: (cd: string | null) => void;
  deviceCards: LeaderOrderBoardDeviceCard[];
  dueAssist: LeaderBoardDueAssistHandle;
  openSearchKeyboard: () => void;
  searchConditions: {
    showGrindingResources: boolean;
    showCuttingResources: boolean;
  };
  toggleGrinding: () => void;
  toggleCutting: () => void;
  completionFilter: LeaderOrderCompletionFilter;
  setCompletionFilter: (v: LeaderOrderCompletionFilter) => void;
  selectedResourceCategory: 'grinding' | 'cutting' | undefined;
  activeResourceCds: string[];
  slotCount: number;
  setSlotModalOpen: (open: boolean) => void;
  selectedResourceCd: string | null;
  listIncomplete: boolean;
};

/**
 * 左ホットゾーン + 操作パネル + 納期アシスト詳細のスタック。
 */
export function LeaderBoardLeftToolStack({
  leftToolStackOuterRef,
  drawerReveal,
  siteKey,
  defaultSites,
  handleSiteChange,
  activeDeviceScopeKey,
  setActiveDeviceScopeKey,
  setSelectedResourceCd,
  deviceCards,
  dueAssist,
  openSearchKeyboard,
  searchConditions,
  toggleGrinding,
  toggleCutting,
  completionFilter,
  setCompletionFilter,
  selectedResourceCategory,
  activeResourceCds,
  slotCount,
  setSlotModalOpen,
  selectedResourceCd,
  listIncomplete
}: LeaderBoardLeftToolStackProps) {
  return (
    <div
      ref={leftToolStackOuterRef}
      className={clsx(
        'pointer-events-auto flex h-full max-h-full',
        KIOSK_REVEAL_TRANSFORM_TRANSITION_CLASS,
        drawerReveal.isVisible ? 'translate-x-0' : '-translate-x-full'
      )}
      onMouseEnter={drawerReveal.onDrawerMouseEnter}
      onMouseLeave={drawerReveal.onDrawerMouseLeave}
    >
      <div
        className="shrink-0"
        style={{ width: KIOSK_LEFT_EDGE_HOT_ZONE_PX }}
        onMouseEnter={drawerReveal.onHotZoneEnter}
        aria-hidden
      />
      <aside
        className="flex h-full min-h-0 w-64 max-w-[85vw] shrink-0 flex-col gap-2 border-r border-white/10 bg-slate-950/98 p-3 shadow-xl"
        aria-label="操作パネル"
      >
        <label className="flex shrink-0 flex-col gap-1 text-[10px] uppercase tracking-wide text-white/55">
          工場
          <select
            value={siteKey}
            onChange={(event) => handleSiteChange(event.target.value)}
            className="rounded border border-white/20 bg-slate-900 px-2 py-2 text-xs text-white"
            aria-label="工場を選択"
          >
            {defaultSites.map((site) => (
              <option key={site} value={site}>
                {site}
              </option>
            ))}
          </select>
        </label>
        <label className="flex shrink-0 flex-col gap-1 text-[10px] uppercase tracking-wide text-white/55">
          対象端末
          <select
            value={activeDeviceScopeKey}
            onChange={(ev) => {
              setActiveDeviceScopeKey(ev.target.value);
              setSelectedResourceCd(null);
            }}
            className="rounded border border-white/20 bg-slate-900 px-2 py-2 text-xs text-white"
          >
            {deviceCards.length === 0 ? (
              <option value="">端末なし</option>
            ) : (
              deviceCards.map((d) => (
                <option key={d.deviceScopeKey} value={d.deviceScopeKey}>
                  {d.label?.trim() || d.deviceScopeKey}
                </option>
              ))
            )}
          </select>
        </label>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded border border-white/15 bg-white/5 p-2">
          <div className="mb-2 flex shrink-0 items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-white/70">製番検索</span>
            <button
              type="button"
              onClick={() => dueAssist.openDetail()}
              disabled={!dueAssist.selectedFseiban}
              className="rounded border border-cyan-400/40 px-2 py-0.5 text-[10px] text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-50"
            >
              詳細
            </button>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <input
              value={dueAssist.searchInput}
              onChange={(event) => dueAssist.setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void dueAssist.applySearch();
                }
              }}
              placeholder="製番を検索"
              className="h-8 min-w-0 flex-1 rounded border border-white/20 bg-white px-2 text-xs text-slate-900"
            />
            <button
              type="button"
              onClick={openSearchKeyboard}
              className="rounded border border-white/20 bg-slate-800 px-2 text-xs text-white hover:bg-slate-700"
              aria-label="キーボードを開く"
            >
              ⌨
            </button>
            <button
              type="button"
              onClick={() => void dueAssist.applySearch()}
              disabled={dueAssist.historyWriting}
              className="rounded bg-blue-600 px-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
            >
              登録
            </button>
          </div>
          <div
            className="mt-2 flex min-h-0 flex-1 flex-wrap content-start gap-1 overflow-y-auto overflow-x-hidden pr-1"
            style={{ WebkitOverflowScrolling: 'touch' }}
            aria-label="登録済み製番"
          >
            {dueAssist.sharedHistory.map((fseiban) => {
              const active = dueAssist.selectedFseiban === fseiban;
              return (
                <div
                  key={fseiban}
                  className={clsx(
                    'relative flex items-center rounded-full border pl-2 pr-5 text-[10px] font-semibold',
                    active
                      ? 'border-emerald-300 bg-emerald-400 text-slate-900'
                      : 'border-white/25 bg-white/10 text-white hover:bg-white/20'
                  )}
                >
                  <button type="button" onClick={() => dueAssist.selectFseiban(fseiban)} className="py-1 font-mono">
                    {fseiban}
                  </button>
                  <button
                    type="button"
                    className={clsx(
                      'absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold',
                      active ? 'bg-slate-200 text-slate-900' : 'bg-white text-slate-900'
                    )}
                    onClick={(event) => {
                      event.stopPropagation();
                      void dueAssist.removeFromHistory(fseiban);
                    }}
                    aria-label={`履歴から削除: ${fseiban}`}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
          <div className="mt-2 shrink-0 text-[10px] text-white/60">
            選択中: <span className="font-mono text-white/90">{dueAssist.selectedFseiban ?? 'なし'}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 text-xs">
          <button
            type="button"
            onClick={toggleGrinding}
            className={clsx(
              'rounded border px-2 py-1',
              searchConditions.showGrindingResources
                ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-100'
                : 'border-white/20 text-white/70'
            )}
          >
            研削
          </button>
          <button
            type="button"
            onClick={toggleCutting}
            className={clsx(
              'rounded border px-2 py-1',
              searchConditions.showCuttingResources
                ? 'border-amber-400/50 bg-amber-500/20 text-amber-100'
                : 'border-white/20 text-white/70'
            )}
          >
            切削
          </button>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 text-[10px] text-white/70">
          <span className="w-full text-[9px] uppercase tracking-wide text-white/45">表示</span>
          {(
            [
              ['all', '両方'],
              ['incomplete', '未完'],
              ['complete', '完了']
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setCompletionFilter(key)}
              className={clsx(
                'rounded border px-2 py-1',
                completionFilter === key
                  ? 'border-violet-400/50 bg-violet-500/20 text-violet-100'
                  : 'border-white/20 text-white/70'
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {selectedResourceCategory ? (
          <p className="shrink-0 text-[10px] text-white/45">検索: {selectedResourceCategory}</p>
        ) : null}
        <button
          type="button"
          onClick={() => setSlotModalOpen(true)}
          className="shrink-0 rounded border border-white/25 bg-slate-800/80 px-2 py-1.5 text-left text-[11px] text-cyan-100 hover:bg-slate-800"
        >
          資源スロット（{activeResourceCds.length}/{slotCount}）
        </button>
        <p className="shrink-0 text-[10px] text-white/55">選択資源: {selectedResourceCd ?? '—'}</p>
        {listIncomplete ? (
          <p className="shrink-0 text-xs text-amber-200/90">
            一覧が1ページに収まっていません。一部の行が表示されないことがあります。
          </p>
        ) : null}
        <div className="mt-auto shrink-0 text-[10px] text-white/40">
          順位は各行のドロップダウンで保存。「-」で納期順の自動並びへ。
        </div>
      </aside>
      <LeaderBoardDueAssistPanel
        isOpen={dueAssist.isDetailOpen}
        selectedFseiban={dueAssist.selectedFseiban}
        detail={dueAssist.detailQuery.data}
        loading={dueAssist.detailQuery.isLoading}
        error={dueAssist.detailQuery.isError}
        dueUpdatePending={dueAssist.dueUpdatePending}
        onClose={dueAssist.closeDetail}
        onOpenSeibanDueDatePicker={dueAssist.openSeibanDueDatePicker}
        onOpenProcessingDueDatePicker={dueAssist.openProcessingDueDatePicker}
      />
    </div>
  );
}
