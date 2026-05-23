import clsx from 'clsx';


import { entityCellPresentation } from '../model/entityPresentation';
import { shelfMasterTheme } from '../theme/shelfMasterTheme';

import type { DraftEntity } from '../model/shelfLayoutTypes';
import type { CSSProperties } from 'react';

type Props = {
  entity: DraftEntity | null;
  selected: boolean;
  relocateSource: boolean;
  flowHighlight: boolean;
  disabled: boolean;
  onClick: () => void;
  style?: CSSProperties;
};

export function ShelfLayoutGridCell({
  entity,
  selected,
  relocateSource,
  flowHighlight,
  disabled,
  onClick,
  style
}: Props) {
  const pres = entityCellPresentation(entity);
  const kindClass =
    pres.kindClass === 'machine'
      ? shelfMasterTheme.cellMachine
      : pres.kindClass === 'shelf'
        ? shelfMasterTheme.cellShelf
        : pres.kindClass === 'aisle'
          ? shelfMasterTheme.cellAisle
          : shelfMasterTheme.cellUnused;

  return (
    <button
      type="button"
      disabled={disabled}
      className={clsx(
        shelfMasterTheme.cellBase,
        kindClass,
        selected && shelfMasterTheme.cellSel,
        relocateSource && shelfMasterTheme.cellRelocateSource,
        flowHighlight && !selected && shelfMasterTheme.cellFlowTarget,
        disabled && shelfMasterTheme.cellDisabled
      )}
      style={style}
      onClick={onClick}
    >
      {pres.kindBadge ? <span className={shelfMasterTheme.cellBadge}>{pres.kindBadge}</span> : null}
      <span
        className={clsx(
          shelfMasterTheme.cellMain,
          pres.kindClass === 'unused' && shelfMasterTheme.cellMainUnused
        )}
      >
        {pres.mainLabel}
      </span>
      {pres.shelfCodeRaw ? <span className={shelfMasterTheme.cellCode}>{pres.shelfCodeRaw}</span> : null}
    </button>
  );
}
