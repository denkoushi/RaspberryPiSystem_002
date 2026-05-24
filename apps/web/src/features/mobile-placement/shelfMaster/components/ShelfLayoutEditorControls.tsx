import { ShelfLayoutEditorDock } from './ShelfLayoutEditorDock';

import type { LayoutEditorDockCallbacks, LayoutEditorDockViewModel } from './layoutEditorDockTypes';

type Props = LayoutEditorDockViewModel & LayoutEditorDockCallbacks;

/** @deprecated 互換ラッパ — 新規は ShelfLayoutEditorDock を直接利用 */
export function ShelfLayoutEditorControls(props: Props) {
  return <ShelfLayoutEditorDock {...props} />;
}
