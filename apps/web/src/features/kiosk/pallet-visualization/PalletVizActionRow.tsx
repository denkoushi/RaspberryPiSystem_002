import { Button } from '../../../components/ui/Button';

import { palletVizCopy } from './copy';

export type PalletVizActionRowProps = {
  busy: boolean;
  canOperate: boolean;
  canClearPallet?: boolean;
  hasSelectedItem: boolean;
  onAdd: () => void;
  onOverwrite: () => void;
  onDelete: () => void;
  onClearPallet: () => void;
};

/**
 * スキャン系操作4ボタン。内側の flex のみにボタンを置き、行高がボタン本来の高さに揃う。
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
}: PalletVizActionRowProps) {
  return (
    <div className="flex min-w-0 shrink-0 flex-nowrap items-center gap-2 overflow-x-auto" aria-label="パレット操作">
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy || !canOperate} onClick={onAdd}>
          {palletVizCopy.actions.add}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy || !hasSelectedItem}
          onClick={onOverwrite}
        >
          {palletVizCopy.actions.overwrite}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy || !hasSelectedItem}
          onClick={onDelete}
        >
          {palletVizCopy.actions.deleteSelected}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="text-red-200 hover:text-red-100"
          disabled={busy || !canClearPallet}
          onClick={onClearPallet}
        >
          {palletVizCopy.actions.clearPallet}
        </Button>
      </div>
    </div>
  );
}
