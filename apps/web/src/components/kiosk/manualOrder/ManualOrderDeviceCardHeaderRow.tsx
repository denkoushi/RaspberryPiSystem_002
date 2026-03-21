import clsx from 'clsx';

import { KIOSK_MANUAL_ORDER_OVERVIEW_BODY_TEXT_CLASS } from '../../../features/kiosk/manualOrder/manualOrderOverviewTypography';

type Props = {
  locationLine: string;
  /** 先頭資源があるときのみ */
  resourceCd?: string;
  assignedCount?: number;
  isActive: boolean;
  onEdit: () => void;
};

/**
 * 端末カード最上段: Location · 資源CD · 件数 · 編集中 · 編集（資源0件時は Location · 編集 のみ）
 */
export function ManualOrderDeviceCardHeaderRow({
  locationLine,
  resourceCd,
  assignedCount,
  isActive,
  onEdit
}: Props) {
  const hasResource = Boolean(resourceCd?.trim().length);
  const cd = resourceCd?.trim() ?? '';

  return (
    <div
      className={clsx(
        'mb-2 flex min-w-0 flex-nowrap items-center gap-2',
        KIOSK_MANUAL_ORDER_OVERVIEW_BODY_TEXT_CLASS
      )}
    >
      <p className="min-w-0 flex-1 truncate font-semibold leading-tight text-cyan-200" title={locationLine}>
        {locationLine}
      </p>
      {hasResource ? (
        <>
          <span className="shrink-0 text-white/35" aria-hidden>
            ·
          </span>
          <span className="shrink-0 font-mono text-white">{cd}</span>
          <span className="shrink-0 text-white/55">{assignedCount ?? 0}件</span>
        </>
      ) : null}
      {isActive ? (
        <span className="shrink-0 text-xs font-semibold text-amber-200" aria-current="true">
          編集中
        </span>
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
  );
}
