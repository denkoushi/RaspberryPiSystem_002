import clsx from 'clsx';

import { Button } from '../../../components/ui/Button';

import { palletVizCopy } from './copy';

export type PalletVizActionRowDensity = 'default' | 'compact';

export type PalletVizActionRowProps = {
  busy: boolean;
  canOperate: boolean;
  canClearPallet?: boolean;
  hasSelectedItem: boolean;
  onAdd: () => void;
  onOverwrite: () => void;
  onDelete: () => void;
  onClearPallet: () => void;
  /** 埋め込み（狭い左ペイン）向け: 4ボタン1行・縦寸法統一 */
  density?: PalletVizActionRowDensity;
};

const COMPACT_BTN =
  'min-h-10 h-10 w-full min-w-0 justify-center truncate px-1 text-xs font-semibold leading-tight';

/**
 * スキャン系操作4ボタン。`compact` 時は折り返しなし1行（持出左ペイン向け）。
 */
export function PalletVizActionRow({
  busy,
  canOperate,
  canClearPallet = true,
  hasSelectedItem,
  onAdd,
  onOverwrite,
  onDelete,
  onClearPallet,
  density = 'default',
}: PalletVizActionRowProps) {
  const compact = density === 'compact';

  return (
    <div
      className={clsx('min-w-0 shrink-0', compact ? 'w-full' : 'flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto')}
      aria-label="パレット操作"
    >
      <div
        className={clsx(
          compact ? 'grid w-full grid-cols-4 gap-1' : 'flex flex-wrap gap-2',
          !compact && 'min-w-0'
        )}
      >
        <Button
          type="button"
          disabled={busy || !canOperate}
          onClick={onAdd}
          className={clsx(compact && COMPACT_BTN)}
        >
          {palletVizCopy.actions.add}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy || !hasSelectedItem}
          onClick={onOverwrite}
          className={clsx(compact && COMPACT_BTN)}
        >
          {palletVizCopy.actions.overwrite}
        </Button>
        <Button
          type="button"
          variant="ghostOnDark"
          disabled={busy || !hasSelectedItem}
          onClick={onDelete}
          className={clsx(compact && COMPACT_BTN)}
        >
          {palletVizCopy.actions.deleteSelected}
        </Button>
        <Button
          type="button"
          variant="ghostOnDark"
          className={clsx(
            compact && COMPACT_BTN,
            '!text-red-300 hover:!text-red-200 hover:bg-white/10'
          )}
          disabled={busy || !canClearPallet}
          onClick={onClearPallet}
        >
          {palletVizCopy.actions.clearPallet}
        </Button>
      </div>
    </div>
  );
}
