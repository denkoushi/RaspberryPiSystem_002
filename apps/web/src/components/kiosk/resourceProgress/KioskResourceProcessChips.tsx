import {
  progressOverviewProcessChipClassName,
  progressOverviewResourceAriaLabel,
  progressOverviewResourceTooltip,
  PROGRESS_OVERVIEW_PART_ROW_RESOURCE_CHIPS_CLASS
} from '../../../features/kiosk/productionSchedule/progressOverviewPresentation';

/** 進捗一覧・アシスト等で共通：資源 CD 進捗チップの最小入力契約 */
export type KioskResourceProgressProcessChip = Readonly<{
  rowId: string;
  resourceCd: string;
  resourceNames?: string[];
  isCompleted: boolean;
}>;

type KioskResourceProcessChipsProps = {
  processes: readonly KioskResourceProgressProcessChip[];
  className?: string;
};

/**
 * キオスク資源 CD 進捗チップの描画（順位ボード行下辺・納期アシスト部品表等で共有）。
 */
export function KioskResourceProcessChips({ processes, className }: KioskResourceProcessChipsProps) {
  const wrap = className ? `${PROGRESS_OVERVIEW_PART_ROW_RESOURCE_CHIPS_CLASS} ${className}` : PROGRESS_OVERVIEW_PART_ROW_RESOURCE_CHIPS_CLASS;
  return (
    <div className={wrap}>
      {processes.map((process) => (
        <span
          key={process.rowId}
          className={progressOverviewProcessChipClassName(process.isCompleted)}
          title={progressOverviewResourceTooltip(process.resourceNames)}
          aria-label={progressOverviewResourceAriaLabel(process.resourceCd, process.resourceNames)}
        >
          {process.resourceCd}
        </span>
      ))}
    </div>
  );
}
