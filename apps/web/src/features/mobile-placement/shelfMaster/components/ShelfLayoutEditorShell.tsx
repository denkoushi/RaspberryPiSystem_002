import { shelfMasterTheme } from '../theme/shelfMasterTheme';

import { ShelfLayoutEditorDock } from './ShelfLayoutEditorDock';

import type { LayoutEditorDockCallbacks, LayoutEditorDockViewModel } from './layoutEditorDockTypes';

type Props = LayoutEditorDockViewModel & LayoutEditorDockCallbacks;

export function ShelfLayoutEditorShell(props: Props) {
  return (
    <div className={shelfMasterTheme.dockShell}>
      <ShelfLayoutEditorDock {...props} />
    </div>
  );
}
