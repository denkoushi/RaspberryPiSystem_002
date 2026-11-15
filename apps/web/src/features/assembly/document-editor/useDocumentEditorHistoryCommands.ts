import { useCallback, useEffect, useRef } from 'react';

import { placeProcedureMaterial } from '../../../api/client';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { matchesMaterialPlacement } from './documentEditorMaterialPlacements';

import type { MaterialHistoryUpdate, OverlayHistory, OverlayHistoryAction } from './documentEditorHistory';
import type { PendingMaterialPlacement } from './documentEditorMaterialPlacements';
import type { useDocumentEditorMaterialPlacements } from './useDocumentEditorMaterialPlacements';
import type { AssemblyProcedureDocumentDto } from '../types';
import type { Dispatch, SetStateAction } from 'react';

type Session = {
  history: OverlayHistory;
  dispatch: Dispatch<OverlayHistoryAction>;
  materials: ReturnType<typeof useDocumentEditorMaterialPlacements>;
  document: AssemblyProcedureDocumentDto | null;
  setDocument: Dispatch<SetStateAction<AssemblyProcedureDocumentDto | null>>;
  passwordInput: string;
  holderToken: string | null;
  readOnly: boolean;
  materialPlacementAllowed: boolean;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setErrorMessage: (message: string) => void;
  onEditLeaseError: (error: unknown) => boolean;
};

export function useDocumentEditorHistoryCommands(session: Session) {
  const latest = useRef(session);
  latest.current = session;
  const mounted = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const travel = useCallback((type: 'undo' | 'redo') => {
    const current = latest.current;
    if (current.readOnly || current.busy || inFlight.current) return;
    const { history, materials, document, holderToken } = current;
    const target = type === 'undo' ? history.past.at(-1) : history.future[0];
    if (!target) return;
    const released = materials.releasedMaterials.current.filter(item => target.some(element => matchesMaterialPlacement(element, item)));
    if (!released.length) { current.dispatch({ type }); return; }
    if (!document || !current.materialPlacementAllowed) return;
    inFlight.current = true;
    current.setBusy(true);
    const scope = materials.materialScope.current;
    const isCurrent = () => mounted.current && scope === materials.materialScope.current &&
      latest.current.document?.id === document.id && latest.current.holderToken === holderToken &&
      !latest.current.readOnly && latest.current.materialPlacementAllowed;
    const restoredMaterials: MaterialHistoryUpdate[] = [];
    const failedMaterials: PendingMaterialPlacement[] = [];
    const placed: Array<{ materialId: string; response: Awaited<ReturnType<typeof placeProcedureMaterial>> }> = [];
    return (async () => {
      try {
        for (const materialId of new Set(released.map(item => item.materialId))) {
          await materials.beforeMaterialPlacement(materialId);
          if (!isCurrent()) break;
          const related = materials.releasedMaterials.current.filter(item => item.materialId === materialId);
          try {
            const active = [...materials.pendingMaterials.current.values()].find(item => item.materialId === materialId);
            let assetId = active?.assetId;
            if (!active) {
              const response = await placeProcedureMaterial({ id: document.id, materialId, pageIndex: target.find(element => related.some(item => matchesMaterialPlacement(element, item)))!.pageIndex, accessPassword: current.passwordInput, holderToken });
              placed.push({ materialId, response });
              assetId = response.asset?.assetId ?? (response.element.kind === 'IMAGE' ? response.element.assetId : undefined);
            }
            restoredMaterials.push(...related.map(placement => ({ placement, assetId })));
          } catch (error) {
            failedMaterials.push(...related);
            if (mounted.current && !current.onEditLeaseError(error)) current.setErrorMessage(readAssemblyApiErrorMessage(error, '素材を再配置できませんでした。'));
          }
        }
        if (!isCurrent()) {
          for (const { materialId, response } of placed) materials.cancelMaterialPlacement(materialId, response.element);
          return;
        }
        for (const { response } of placed) {
          const { asset } = response;
          if (asset) current.setDocument(value => value ? { ...value, assets: { ...value.assets, [asset.assetId]: asset } } : value);
        }
        for (const update of restoredMaterials) {
          if (target.some(element => matchesMaterialPlacement(element, update.placement))) {
            materials.pendingMaterials.current.set(update.placement.elementId, { ...update.placement, ...(update.assetId ? { assetId: update.assetId } : {}) });
          }
        }
        materials.releasedMaterials.current = materials.releasedMaterials.current
          .filter(item => !failedMaterials.includes(item) && !released.includes(item))
          .map(item => {
            const update = restoredMaterials.find(candidate => candidate.placement === item);
            return update?.assetId ? { ...item, assetId: update.assetId } : item;
          });
        if (placed.length) materials.markMaterialsPlaced();
        current.dispatch({ type, restoredMaterials, failedMaterials });
      } finally {
        inFlight.current = false;
        if (mounted.current) current.setBusy(false);
      }
    })();
  }, []);
  const undo = useCallback(() => travel('undo'), [travel]);
  const redo = useCallback(() => travel('redo'), [travel]);
  return { undo, redo };
}
