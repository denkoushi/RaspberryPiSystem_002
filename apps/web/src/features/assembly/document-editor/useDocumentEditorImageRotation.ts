import { useCallback, useEffect, useRef } from 'react';

import { rotateAssemblyProcedureAsset } from '../../../api/client';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { findAttachedOverlayIds, isPhoto } from './assemblyDocumentEditorDraft';
import { matchesMaterialPlacement } from './documentEditorMaterialPlacements';

import type { ImageRotationDirection, OverlayDraftAction } from './assemblyDocumentEditorDraft';
import type { useDocumentEditorMaterialPlacements } from './useDocumentEditorMaterialPlacements';
import type { AssemblyProcedureDocumentDto } from '../types';
import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';
import type { Dispatch, SetStateAction } from 'react';

type Session = {
  document: AssemblyProcedureDocumentDto | null;
  elements: AssemblyProcedureOverlayElement[];
  selectedElement: AssemblyProcedureOverlayElement | null;
  passwordInput: string;
  holderToken: string | null;
  readOnly: boolean;
  busy: boolean;
  materials: Pick<ReturnType<typeof useDocumentEditorMaterialPlacements>, 'pendingMaterials' | 'materialScope'>;
  dispatch: Dispatch<OverlayDraftAction>;
  setDocument: Dispatch<SetStateAction<AssemblyProcedureDocumentDto | null>>;
  setBusy: (busy: boolean) => void;
  setErrorMessage: (message: string | null) => void;
  onEditLeaseError: (error: unknown) => boolean;
};

export function useDocumentEditorImageRotation(session: Session) {
  const latest = useRef(session);
  latest.current = session;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  return useCallback(async (direction: ImageRotationDirection, pageAspect: number) => {
    const current = latest.current;
    const { document, selectedElement: photo, elements, holderToken, materials } = current;
    if (!document || !photo || !isPhoto(photo) || current.readOnly || current.busy ||
      !(pageAspect > 0 && Number.isFinite(pageAspect))) return;

    const attachedIds = new Set(findAttachedOverlayIds(elements, photo.id));
    const images = elements.filter((element): element is Extract<AssemblyProcedureOverlayElement, { kind: 'IMAGE' }> =>
      element.kind === 'IMAGE' && (element.id === photo.id || attachedIds.has(element.id)));
    if (!images.length || images.some(element => !element.assetId)) return;

    const scope = materials.materialScope.current;
    const isCurrent = () => mounted.current && materials.materialScope.current === scope &&
      latest.current.document?.id === document.id && latest.current.document?.editVersion === document.editVersion &&
      latest.current.holderToken === holderToken && !latest.current.readOnly;
    current.setBusy(true);
    current.setErrorMessage(null);
    try {
      const sourceAssetIds = [...new Set(images.map(image => image.assetId))];
      const results = await Promise.allSettled(sourceAssetIds.map(async (assetId) => [
        assetId, await rotateAssemblyProcedureAsset({
          id: document.id, accessPassword: current.passwordInput, holderToken, assetId, direction
        })
      ] as const));
      if (!isCurrent()) return;
      const assets = new Map(results.map(result => {
        if (result.status === 'rejected') throw result.reason;
        return result.value;
      }));
      const newAssetIds = new Map(images.map(image => [image.id, assets.get(image.assetId)!.assetId]));
      const pending = materials.pendingMaterials.current;
      for (const image of images) {
        const placement = pending.get(image.id);
        if (placement && matchesMaterialPlacement(image, placement)) {
          pending.set(image.id, { ...placement, rotatedAssetIds: [...(placement.rotatedAssetIds ?? []), newAssetIds.get(image.id)!] });
        }
      }
      current.setDocument(value => value ? {
        ...value,
        assets: { ...value.assets, ...Object.fromEntries([...assets.values()].map(asset => [asset.assetId, asset])) }
      } : value);
      current.dispatch({ type: 'rotateImage', id: photo.id, direction, newAssetIds, pageAspect });
    } catch (error) {
      if (isCurrent() && !current.onEditLeaseError(error)) {
        current.setErrorMessage(readAssemblyApiErrorMessage(error, '写真を回せませんでした。'));
      }
    } finally {
      if (mounted.current) current.setBusy(false);
    }
  }, []);
}
