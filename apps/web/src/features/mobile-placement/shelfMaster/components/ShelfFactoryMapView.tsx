import { getMacroZoneById, getNeighborMacroZoneId, type MacroZoneId } from '@raspi-system/shelf-layout-core';

import { buildRenderItems } from '../model/shelfLayoutGrid';
import { shelfMasterTheme } from '../theme/shelfMasterTheme';

import { ShelfLayoutGridCell } from './ShelfLayoutGridCell';

import type { DraftEntity } from '../model/shelfLayoutTypes';


type Props = {
  zoneId: MacroZoneId;
  gridSize: 3 | 4;
  draftEntities: DraftEntity[];
  selectedCells: number[];
  relocateSource: string | null;
  tab: 'layout' | 'relocate' | 'zero2w';
  layoutEmphasizeCells: boolean;
  /** 棚番パイ選択中はレイアウト用セル操作を無効 */
  layoutCellsBlocked?: boolean;
  /** Pi 選択後、SHELF セルのみタップ可能 */
  zero2wMapShelfPick?: boolean;
  zero2wPickedShelfCode?: string | null;
  relocateEmphasize: 'source' | 'target' | null;
  relocateCellActionable: (entity: DraftEntity | null) => boolean;
  relocateCellsDisabled: boolean;
  onOpenZone: (id: MacroZoneId) => void;
  onToggleCell: (cells: number[]) => void;
};

export function ShelfFactoryMapView({
  zoneId,
  gridSize,
  draftEntities,
  selectedCells,
  relocateSource,
  tab,
  layoutEmphasizeCells,
  layoutCellsBlocked = false,
  zero2wMapShelfPick = false,
  zero2wPickedShelfCode = null,
  relocateEmphasize,
  relocateCellActionable,
  relocateCellsDisabled,
  onOpenZone,
  onToggleCell
}: Props) {
  const items = buildRenderItems(draftEntities, gridSize);

  return (
    <div className={shelfMasterTheme.factoryMap}>
      {(['nw', 'n', 'ne', 'w', null, 'e', 'sw', 's', 'se'] as const).map((dir, idx) => {
        if (dir === null) {
          return (
            <div key={`c-${idx}`} className={shelfMasterTheme.centerZone}>
              <div className={shelfMasterTheme.centerZoneTitle}>{getMacroZoneById(zoneId).displayName}</div>
              <div
                className="grid flex-1 gap-0.5"
                style={{
                  gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${gridSize}, minmax(0, 1fr))`
                }}
              >
                {items.map((item) => {
                  const layoutSel = item.cells.some((c) => selectedCells.includes(c));
                  const zero2wSel =
                    zero2wPickedShelfCode != null &&
                    zero2wPickedShelfCode.length > 0 &&
                    item.entity?.shelfCodeRaw === zero2wPickedShelfCode;
                  const sel = layoutSel || zero2wSel;
                  const isRelocateSource = item.entity?.shelfCodeRaw === relocateSource;
                  const relocateFlow =
                    tab === 'relocate' &&
                    relocateEmphasize != null &&
                    relocateCellActionable(item.entity) &&
                    !isRelocateSource;
                  const layoutFlow =
                    tab === 'layout' && layoutEmphasizeCells && !sel && item.entity == null;
                  const zero2wFlow =
                    tab === 'layout' &&
                    zero2wMapShelfPick &&
                    item.entity?.entityKind === 'SHELF' &&
                    item.entity.shelfCodeRaw != null &&
                    !zero2wSel;
                  const disabled =
                    tab === 'relocate'
                      ? relocateCellsDisabled || !relocateCellActionable(item.entity)
                      : tab === 'zero2w'
                        ? true
                        : zero2wMapShelfPick
                          ? item.entity?.entityKind !== 'SHELF' || item.entity.shelfCodeRaw == null
                          : layoutCellsBlocked;

                  return (
                    <ShelfLayoutGridCell
                      key={item.cells.join('-')}
                      entity={item.entity}
                      selected={sel}
                      relocateSource={isRelocateSource}
                      flowHighlight={relocateFlow || layoutFlow || zero2wFlow}
                      disabled={disabled}
                      onClick={() => onToggleCell(item.cells)}
                      style={{
                        gridColumn: `${item.minC + 1} / ${item.maxC + 2}`,
                        gridRow: `${item.minR + 1} / ${item.maxR + 2}`
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        }
        const neighborId = getNeighborMacroZoneId(zoneId, dir);
        if (!neighborId) return <div key={dir} />;
        const neighbor = getMacroZoneById(neighborId);
        return (
          <button
            key={dir}
            type="button"
            className={shelfMasterTheme.neighborBtn}
            style={{
              gridColumn: dir === 'nw' || dir === 'w' || dir === 'sw' ? 1 : dir === 'n' || dir === 's' ? 3 : 5,
              gridRow: dir === 'nw' || dir === 'n' || dir === 'ne' ? 1 : dir === 'w' || dir === 'e' ? 3 : 5
            }}
            onClick={() => onOpenZone(neighborId)}
          >
            {neighbor.displayName}
          </button>
        );
      })}
    </div>
  );
}
