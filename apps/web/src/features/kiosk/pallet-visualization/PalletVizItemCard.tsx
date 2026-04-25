import clsx from 'clsx';

import { formatPalletVizDisplayOrDash, formatPalletVizQuantityLabel } from './palletVizItemCardFormatters';
import { palletVizItemCardTokens as t } from './palletVizItemCardTokens';

import type { PalletVizListItem } from './palletVizListItem';

export type PalletVizItemCardProps = {
  item: PalletVizListItem;
  selected: boolean;
  onToggle: () => void;
};

export function PalletVizItemCard({ item, selected, onToggle }: PalletVizItemCardProps) {
  const machineLine = (item.machineNameDisplay ?? item.machineName)?.trim() || null;
  const fhincdDisplay = formatPalletVizDisplayOrDash(item.fhincd);

  return (
    <button type="button" aria-pressed={selected} onClick={onToggle} className={clsx(t.root, selected ? t.selected : t.unselected)}>
      <div className={t.row1}>
        <div className={t.palletNo}>{item.palletNo}</div>
        {machineLine ? (
          <div className={t.machineName} title={machineLine}>
            {machineLine}
          </div>
        ) : (
          <div className={t.machineName} aria-hidden />
        )}
        <div className={t.quantity}>{formatPalletVizQuantityLabel(item.plannedQuantity)}</div>
      </div>
      <div className={t.row2}>
        <div className={t.fseiban}>{formatPalletVizDisplayOrDash(item.fseiban)}</div>
        <div className={t.fhincd} title={fhincdDisplay}>
          {fhincdDisplay}
        </div>
      </div>
      <div className={t.row3}>
        <span className={t.startDate}>{formatPalletVizDisplayOrDash(item.plannedStartDateDisplay)}</span>
        <span className={t.partName}>{formatPalletVizDisplayOrDash(item.fhinmei)}</span>
      </div>
    </button>
  );
}
