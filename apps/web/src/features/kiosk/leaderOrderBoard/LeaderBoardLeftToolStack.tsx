import clsx from 'clsx';
import { useEffect, useId, useRef, useState } from 'react';

import { KIOSK_REVEAL_TRANSFORM_TRANSITION_CLASS } from '../../../hooks/kioskRevealUi';
import { KIOSK_LEFT_EDGE_HOT_ZONE_PX } from '../../../hooks/useKioskLeftEdgeDrawerReveal';

import { LeaderBoardDueAssistPanel } from './LeaderBoardDueAssistPanel';
import { LeaderBoardSeibanRankPicker } from './LeaderBoardSeibanRankPicker';

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
  /** 表示中製番一覧パネル（ページ側オーバーレイ）の開閉 */
  isSeibanListPanelOpen: boolean;
  onToggleSeibanListPanel: () => void;
  /** 端末ローカルのみ: 製番順を最優先表示する評価モード（共有履歴とは独立） */
  seibanEvalEnabled: boolean;
  onToggleSeibanEval: () => void;
  /** 登録製番ボタン列の表示順（評価モードOFF時は共有履歴順・ON時はマージ順をページ側で選ぶ） */
  registeredSeibansForDisplay: readonly string[];
  /** 製番順評価ON時: 表示順を 1 始まりの順位へ変更（他製番は繰り上げ／繰り下げ） */
  onMoveRegisteredSeibanToRank: (fseiban: string, targetRank1Based: number) => void;
  /** 背景同期中など、製番検索・登録を明示的に無効化 */
  interactionLocked?: boolean;
  /** ガント表示（所要量比例の行高） */
  ganttEnabled: boolean;
  onToggleGanttMode: () => void;
  /** 分割機能の状態表示（メインの資源スロット領域を消費しない） */
  splitFeatureStatus: {
    label: string;
    className: string;
  };
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
  listIncomplete,
  isSeibanListPanelOpen,
  onToggleSeibanListPanel,
  seibanEvalEnabled,
  onToggleSeibanEval,
  registeredSeibansForDisplay,
  onMoveRegisteredSeibanToRank,
  interactionLocked = false,
  ganttEnabled,
  onToggleGanttMode,
  splitFeatureStatus
}: LeaderBoardLeftToolStackProps) {
  const seibanControlsLocked = interactionLocked;
  const rankPickerPanelDomId = useId();
  const rankPickerAnchorRef = useRef<HTMLElement | null>(null);
  const rankPickerPanelRef = useRef<HTMLDivElement | null>(null);
  const [rankPickerForFseiban, setRankPickerForFseiban] = useState<string | null>(null);

  useEffect(() => {
    if (!seibanEvalEnabled) {
      setRankPickerForFseiban(null);
    }
  }, [seibanEvalEnabled]);

  useEffect(() => {
    if (rankPickerForFseiban != null && !registeredSeibansForDisplay.includes(rankPickerForFseiban)) {
      setRankPickerForFseiban(null);
    }
  }, [rankPickerForFseiban, registeredSeibansForDisplay]);

  const rankPickerCurrentIndex =
    rankPickerForFseiban != null ? registeredSeibansForDisplay.indexOf(rankPickerForFseiban) : -1;
  const rankPickerCurrentRank = rankPickerCurrentIndex >= 0 ? rankPickerCurrentIndex + 1 : 1;

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
        className={clsx(
          'flex h-full min-h-0 shrink-0 flex-col gap-2 border-r border-white/10 bg-slate-950 p-3 shadow-xl max-w-[90vw]',
          seibanEvalEnabled ? 'w-96' : 'w-80'
        )}
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
        <div className="flex shrink-0 items-center justify-between gap-2 rounded border border-white/10 bg-slate-900/70 px-2 py-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-white/55">分割</span>
          <span
            className={clsx(
              'shrink-0 rounded border px-2 py-0.5 text-[10px] font-bold leading-tight',
              splitFeatureStatus.className
            )}
          >
            {splitFeatureStatus.label}
          </span>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded border border-white/15 bg-slate-900 p-2">
          <div className="mb-2 flex min-w-0 shrink-0 items-center justify-between gap-1">
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-white/70">
              製番検索
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={onToggleSeibanListPanel}
                aria-pressed={isSeibanListPanelOpen}
                className={clsx(
                  'rounded border px-2 py-0.5 text-[10px] hover:bg-white/10',
                  isSeibanListPanelOpen
                    ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-50'
                    : 'border-white/25 bg-white/5 text-white/90'
                )}
              >
                製番一覧
              </button>
              <button
                type="button"
                onClick={() => dueAssist.openDetail()}
                disabled={!dueAssist.selectedFseiban}
                className="rounded border border-cyan-400/40 px-2 py-0.5 text-[10px] text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-50"
              >
                詳細
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => dueAssist.clearFseibanFilters()}
            disabled={seibanControlsLocked || dueAssist.selectedFseibanFilters.length === 0}
            className="mb-2 w-full shrink-0 rounded border border-white/20 bg-slate-800/70 px-2 py-1 text-[10px] text-white/90 hover:bg-slate-800 disabled:opacity-40"
          >
            製番OR検索を全解除
          </button>
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2 rounded border border-violet-400/30 bg-violet-500/10 px-2 py-1.5">
            <div className="min-w-0 text-[9px] leading-tight text-violet-100/90">
              <div className="font-semibold text-violet-50">製番順評価</div>
              <div className="text-white/55">ON で順位ボードを製番順優先（この端末のみ）</div>
            </div>
            <button
              type="button"
              onClick={onToggleSeibanEval}
              aria-pressed={seibanEvalEnabled}
              className={clsx(
                'shrink-0 rounded border px-2 py-1 text-[10px] font-semibold',
                seibanEvalEnabled
                  ? 'border-violet-300 bg-violet-500/40 text-white'
                  : 'border-white/25 bg-white/5 text-white/80 hover:bg-white/10'
              )}
            >
              {seibanEvalEnabled ? 'ON' : 'OFF'}
            </button>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <input
              value={dueAssist.searchInput}
              disabled={seibanControlsLocked}
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
              disabled={seibanControlsLocked}
              className="rounded border border-white/20 bg-slate-800 px-2 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
              aria-label="キーボードを開く"
            >
              ⌨
            </button>
            <button
              type="button"
              onClick={() => void dueAssist.applySearch()}
              disabled={seibanControlsLocked || dueAssist.historyWriting}
              className="rounded bg-blue-600 px-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
            >
              登録
            </button>
          </div>
          <div
            className={clsx(
              'mt-2 grid min-h-0 flex-1 gap-2 content-start overflow-y-auto overflow-x-hidden pr-0.5',
              seibanEvalEnabled ? 'grid-cols-1' : 'grid-cols-2'
            )}
            style={{ WebkitOverflowScrolling: 'touch' }}
            aria-label="登録済み製番"
          >
            {registeredSeibansForDisplay.map((fseiban, rankIdx) => {
              const filtered = dueAssist.isFseibanFilterSelected(fseiban);
              const displayRank = rankIdx + 1;
              return (
                <div
                  key={fseiban}
                  className={clsx(
                    'relative flex min-h-[2.5rem] min-w-0 w-full items-stretch rounded-lg border',
                    filtered
                      ? 'border-emerald-300 bg-emerald-400 text-slate-900'
                      : 'border-white/25 bg-white/10 text-white hover:bg-white/20'
                  )}
                >
                  {seibanEvalEnabled ? (
                    <div
                      className={clsx(
                        'flex min-w-[2.75rem] shrink-0 flex-col justify-stretch border-r',
                        filtered ? 'border-slate-900/15' : 'border-white/15'
                      )}
                    >
                      <button
                        type="button"
                        ref={(el) => {
                          if (fseiban === rankPickerForFseiban) {
                            rankPickerAnchorRef.current = el;
                          } else if (el != null && rankPickerAnchorRef.current === el) {
                            rankPickerAnchorRef.current = null;
                          }
                        }}
                        className={clsx(
                          'flex min-h-[2.5rem] flex-1 items-center justify-center text-sm font-bold tabular-nums leading-none',
                          filtered
                            ? 'text-slate-900 hover:bg-slate-900/12'
                            : 'text-white/95 hover:bg-white/10'
                        )}
                        aria-label={`順位 ${displayRank}、タップで変更`}
                        aria-haspopup="dialog"
                        aria-expanded={rankPickerForFseiban === fseiban}
                        disabled={seibanControlsLocked}
                        onClick={() =>
                          setRankPickerForFseiban((prev) => (prev === fseiban ? null : fseiban))
                        }
                      >
                        {displayRank}
                      </button>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => dueAssist.toggleFseibanFilter(fseiban)}
                    disabled={seibanControlsLocked}
                    className="min-w-0 flex-1 px-2 py-2 text-left text-sm font-semibold leading-tight font-mono disabled:opacity-50"
                    aria-pressed={filtered}
                  >
                    {fseiban}
                  </button>
                  <button
                    type="button"
                    className={clsx(
                      'flex min-h-[2.25rem] min-w-[2.25rem] shrink-0 items-center justify-center rounded-r-[0.4rem] text-base font-bold leading-none',
                      filtered ? 'bg-slate-900/25 text-slate-900 hover:bg-slate-900/35' : 'bg-white/15 text-white hover:bg-white/25'
                    )}
                    disabled={seibanControlsLocked}
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
          <div className="mt-2 shrink-0 space-y-0.5 text-[10px] text-white/60">
            <div>
              OR検索:{' '}
              <span className="break-all font-mono text-white/90">
                {dueAssist.selectedFseibanFilters.length === 0
                  ? 'なし'
                  : `${dueAssist.selectedFseibanFilters.length}件（${dueAssist.selectedFseibanFilters.join(' · ')}）`}
              </span>
            </div>
            <div>
              納期詳細の製番:{' '}
              <span className="font-mono text-white/90">{dueAssist.selectedFseiban ?? '—'}</span>
            </div>
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
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-[10px] text-white/70">
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
          <button
            type="button"
            onClick={onToggleGanttMode}
            aria-pressed={ganttEnabled}
            aria-label={ganttEnabled ? 'ガント表示をオフにする' : 'ガント表示をオンにする'}
            className={clsx(
              'rounded border px-2 py-1 font-semibold',
              ganttEnabled
                ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-100'
                : 'border-white/20 text-white/70 hover:bg-white/5'
            )}
          >
            {ganttEnabled ? 'ガントON' : 'ガントOFF'}
          </button>
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
          {seibanEvalEnabled ? (
            <>
              {' '}
              評価 ON 時、各スロットの「順位」で未設定行に空き番号を自動付与。各行ドロップダウンでも変更可。
            </>
          ) : null}
        </div>
      </aside>
      <LeaderBoardSeibanRankPicker
        isOpen={rankPickerForFseiban != null}
        anchorRef={rankPickerAnchorRef}
        panelRef={rankPickerPanelRef}
        panelId={rankPickerPanelDomId}
        totalCount={registeredSeibansForDisplay.length}
        currentRank={rankPickerCurrentRank}
        onSelectRank={(rank) => {
          if (rankPickerForFseiban != null) {
            onMoveRegisteredSeibanToRank(rankPickerForFseiban, rank);
          }
        }}
        onRequestClose={() => setRankPickerForFseiban(null)}
      />
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
