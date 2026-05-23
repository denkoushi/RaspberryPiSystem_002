import clsx from 'clsx';

import { draftEntitiesFromSummary } from '../model/summaryEntities';
import { buildZoneOverviewCells } from '../model/zoneOverviewCells';
import { shelfMasterTheme } from '../theme/shelfMasterTheme';

import { ShelfLayoutMiniCell } from './ShelfLayoutMiniCell';

import type { ShelfLayoutSummaryDto } from '../../../../api/client';

type Props = {
  zone: ShelfLayoutSummaryDto;
  overviewMode: 'layout' | 'relocate';
  showEditButton: boolean;
  onEdit: () => void;
  onOpenRelocate: () => void;
};

export function ShelfMacroZoneCard({ zone, overviewMode, showEditButton, onEdit, onOpenRelocate }: Props) {
  const gridSize = (zone.gridSize === 4 ? 4 : 3) as 3 | 4;
  const entities = draftEntitiesFromSummary(zone.entities ?? []);
  const cells = buildZoneOverviewCells(entities, gridSize);
  const clickable = overviewMode === 'relocate';

  const inner = (
    <>
      <div className={shelfMasterTheme.macroHead}>
        <span className={shelfMasterTheme.macroName}>{zone.displayName}</span>
        <span className={shelfMasterTheme.macroLegend}>
          <span>機{zone.machineCount}</span>
          <span className="ml-2">棚{zone.shelfCount}</span>
        </span>
        {showEditButton ? (
          <button
            type="button"
            className={shelfMasterTheme.macroEditBtn}
            onClick={(ev) => {
              ev.stopPropagation();
              onEdit();
            }}
          >
            編集
          </button>
        ) : null}
      </div>
      <div
        className={shelfMasterTheme.miniMap}
        style={{
          gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${gridSize}, minmax(0, 1fr))`
        }}
      >
        {cells.map((cell, i) => (
          <ShelfLayoutMiniCell key={i} entity={cell.entity} />
        ))}
      </div>
    </>
  );

  if (clickable) {
    return (
      <button
        type="button"
        className={clsx(shelfMasterTheme.macroZoneCard, shelfMasterTheme.macroZoneCardClickable, 'text-left')}
        onClick={onOpenRelocate}
      >
        {inner}
      </button>
    );
  }

  return <div className={shelfMasterTheme.macroZoneCard}>{inner}</div>;
}
