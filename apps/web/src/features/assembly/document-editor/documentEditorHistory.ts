import { moveOverlayPage, overlayDraftReducer, overlayDraftSnapshot, removeOverlayPage, shiftOverlayPages, type OverlayDraftAction } from './assemblyDocumentEditorDraft';
import { matchesMaterialPlacement, removeMaterialPlacements, type PendingMaterialPlacement } from './documentEditorMaterialPlacements';

import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

export type MaterialHistoryUpdate = { placement: PendingMaterialPlacement; assetId?: string };
export type OverlayHistoryAction = OverlayDraftAction
  | { type: 'releaseMaterials'; placements: PendingMaterialPlacement[]; replacement?: AssemblyProcedureOverlayElement; preserveHistory?: boolean }
  | { type: 'shiftPages'; afterPageIndex: number; pageCount?: number; importedElements?: AssemblyProcedureOverlayElement[] }
  | { type: 'deletePage'; pageIndex: number }
  | { type: 'movePage'; from: number; to: number }
  | { type: 'undo'; restoredMaterials?: MaterialHistoryUpdate[]; failedMaterials?: PendingMaterialPlacement[] }
  | { type: 'redo'; restoredMaterials?: MaterialHistoryUpdate[]; failedMaterials?: PendingMaterialPlacement[] }
  | { type: 'beginDrag' }
  | { type: 'endDrag' };

export type OverlayHistory = { past: AssemblyProcedureOverlayElement[][]; present: AssemblyProcedureOverlayElement[]; future: AssemblyProcedureOverlayElement[][]; dragStart: AssemblyProcedureOverlayElement[] | null };
export function historyReducer(state: OverlayHistory, action: OverlayHistoryAction): OverlayHistory {
  if (action.type === 'releaseMaterials') {
    if (action.replacement) state = historyReducer(state, { type: 'update', element: action.replacement });
    const remove = (items: AssemblyProcedureOverlayElement[]) => removeMaterialPlacements(items, action.placements);
    const present = remove(state.present);
    const compact = (items: AssemblyProcedureOverlayElement[][]) => items.filter((item, index) => overlayDraftSnapshot(item) !== overlayDraftSnapshot(index ? items[index - 1] : present));
    if (action.preserveHistory) return { ...state, present };
    return { present, past: compact(state.past.map(remove).reverse()).reverse(), future: compact(state.future.map(remove)), dragStart: state.dragStart ? remove(state.dragStart) : null };
  }
  if ((action.type === 'undo' || action.type === 'redo') && (action.restoredMaterials || action.failedMaterials)) {
    const restore = (items: AssemblyProcedureOverlayElement[]) => removeMaterialPlacements(items.map(element => {
      const update = action.restoredMaterials?.find(item => matchesMaterialPlacement(element, item.placement));
      return update?.assetId && element.kind === 'IMAGE' && element.assetId === update.placement.assetId ? { ...element, assetId: update.assetId } : element;
    }), action.failedMaterials ?? []);
    state = { ...state, present: restore(state.present), past: state.past.map(restore), future: state.future.map(restore) };
  }
  if (action.type === 'deletePage') {
    const survivingPages = new Map(state.present.filter(element => element.pageIndex !== action.pageIndex).map(element => [element.id, element.pageIndex]));
    const remove = (elements: AssemblyProcedureOverlayElement[]) => removeOverlayPage(elements.map(element => {
      const pageIndex = survivingPages.get(element.id);
      return element.pageIndex === action.pageIndex && pageIndex !== undefined ? { ...element, pageIndex } : element;
    }), action.pageIndex);
    const present = remove(state.present);
    const compact = (items: AssemblyProcedureOverlayElement[][]) => items.filter((item, index) => overlayDraftSnapshot(item) !== overlayDraftSnapshot(index ? items[index - 1] : present));
    return { past: compact(state.past.map(remove).reverse()).reverse(), present, future: compact(state.future.map(remove)), dragStart: state.dragStart ? remove(state.dragStart) : null };
  }
  if (action.type === 'movePage') {
    const move = (elements: AssemblyProcedureOverlayElement[]) => moveOverlayPage(elements, action.from, action.to);
    return { past: state.past.map(move), present: move(state.present), future: state.future.map(move), dragStart: state.dragStart ? move(state.dragStart) : null };
  }
  if (action.type === 'shiftPages') {
    const shift = (elements: AssemblyProcedureOverlayElement[]) => [
      ...shiftOverlayPages(elements, action.afterPageIndex, action.pageCount),
      ...(action.importedElements ?? [])
    ];
    return { past: state.past.map(shift), present: shift(state.present), future: state.future.map(shift), dragStart: state.dragStart ? shift(state.dragStart) : null };
  }
  if (action.type === 'beginDrag') return { ...state, dragStart: state.present };
  if (action.type === 'endDrag') {
    if (!state.dragStart) return state;
    if (overlayDraftSnapshot(state.dragStart) === overlayDraftSnapshot(state.present)) return { ...state, dragStart: null };
    return { dragStart: null, past: [...state.past.slice(-49), state.dragStart], present: state.present, future: [] };
  }
  if (action.type === 'undo') {
    if (!state.past.length) return state;
    return { dragStart: null, past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future] };
  }
  if (action.type === 'redo') {
    if (!state.future.length) return state;
    return { dragStart: null, past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) };
  }
  if (action.type === 'rotateImage' && state.dragStart) state = historyReducer(state, { type: 'endDrag' });
  const present = overlayDraftReducer(state.present, action, state.dragStart ?? undefined);
  if (action.type === 'replace' && action.preserveHistory) return { ...state, present };
  if (action.type === 'replace' || action.type === 'clear') return { dragStart: null, past: [], present, future: [] };
  if (overlayDraftSnapshot(present) === overlayDraftSnapshot(state.present)) return state;
  if (state.dragStart) return { ...state, present };
  return { dragStart: null, past: [...state.past.slice(-49), state.present], present, future: [] };
}

