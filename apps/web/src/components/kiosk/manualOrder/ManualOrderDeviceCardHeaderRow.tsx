import clsx from 'clsx';

import { KIOSK_MANUAL_ORDER_OVERVIEW_BODY_TEXT_CLASS } from '../../../features/kiosk/manualOrder/manualOrderOverviewTypography';

import type { ManualOrderCardResourceSubtitleParts } from '../../../features/kiosk/manualOrder/manualOrderOverviewCardPresentation';

type Props = {
  locationLine: string;
  /** 先頭割当資源があるときのみ（2行目を描画） */
  resourceSubtitle: ManualOrderCardResourceSubtitleParts | null;
  isActive: boolean;
  onEdit: () => void;
  /** 資源CD割り当てモーダル（手動順番 v2） */
  onResourceSettings?: () => void;
};

/**
 * 端末カード最上段: 1行目 Location ＋ 操作、2行目 資源名称·資源CD·件数（資源なし時は1行のみ）
 */
export function ManualOrderDeviceCardHeaderRow({
  locationLine,
  resourceSubtitle,
  isActive,
  onEdit,
  onResourceSettings
}: Props) {
  const line2Title = resourceSubtitle
    ? [
        resourceSubtitle.displayName,
        resourceSubtitle.resourceCd,
        `${resourceSubtitle.assignedCount}件`
      ]
        .filter((s) => s.length > 0)
        .join(' · ')
    : '';

  return (
    <div className={clsx('mb-2 flex min-w-0 flex-col gap-1', KIOSK_MANUAL_ORDER_OVERVIEW_BODY_TEXT_CLASS)}>
      <div className="flex min-w-0 flex-nowrap items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-semibold leading-tight text-cyan-200" title={locationLine}>
          {locationLine}
        </p>
        {isActive ? (
          <span className="shrink-0 text-xs font-semibold text-amber-200" aria-current="true">
            編集中
          </span>
        ) : null}
        {onResourceSettings ? (
          <button
            type="button"
            onClick={onResourceSettings}
            className="shrink-0 rounded border border-cyan-500/40 bg-cyan-500/15 px-2 py-1 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25"
            aria-label={`${locationLine} の資源割り当て`}
          >
            資源
          </button>
        ) : null}
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 rounded border border-white/20 bg-white/10 px-2 py-1 text-xs font-semibold text-amber-300 hover:bg-white/20"
          aria-label={`${locationLine} を編集`}
        >
          編集
        </button>
      </div>
      {resourceSubtitle ? (
        <p
          className="min-w-0 truncate text-[11px] leading-tight text-white/70"
          title={line2Title.length > 0 ? line2Title : undefined}
        >
          {resourceSubtitle.displayName.length > 0 ? (
            <>
              <span className="text-slate-200">{resourceSubtitle.displayName}</span>
              <span className="text-white/35" aria-hidden>
                {' '}
                ·{' '}
              </span>
            </>
          ) : null}
          <span className="font-mono text-white/90">{resourceSubtitle.resourceCd}</span>
          <span className="text-white/35" aria-hidden>
            {' '}
            ·{' '}
          </span>
          <span className="tabular-nums text-white/55">{resourceSubtitle.assignedCount}件</span>
        </p>
      ) : null}
    </div>
  );
}
