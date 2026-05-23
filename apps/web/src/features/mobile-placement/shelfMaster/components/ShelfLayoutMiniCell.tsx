import clsx from 'clsx';

import { entityCellPresentation } from '../model/entityPresentation';
import { shelfMasterTheme } from '../theme/shelfMasterTheme';

import type { DraftEntity } from '../model/shelfLayoutTypes';

type Props = {
  entity: DraftEntity | null;
};

export function ShelfLayoutMiniCell({ entity }: Props) {
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
    <div className={clsx(shelfMasterTheme.miniCell, kindClass)}>
      {pres.kindBadge ? <span className={shelfMasterTheme.miniCellKind}>{pres.kindBadge}</span> : null}
      <span className={shelfMasterTheme.miniCellMain}>{pres.mainLabel}</span>
    </div>
  );
}
