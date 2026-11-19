import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { rotateAssemblyProcedureAsset } from '../../../api/client';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { findAttachedOverlayIds, isPhoto, rotateImageOverlay } from './assemblyDocumentEditorDraft';
import { matchesMaterialPlacement } from './documentEditorMaterialPlacements';

import type { ImageRotationDirection, OverlayDraftAction } from './assemblyDocumentEditorDraft';
import type { useDocumentEditorMaterialPlacements } from './useDocumentEditorMaterialPlacements';
import type { AssemblyProcedureDocumentDto, AssemblyProcedureOverlayAssetDto } from '../types';
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

type Rotation = { direction: ImageRotationDirection; pageAspect: number };
type PreloadImages = (assets: AssemblyProcedureOverlayAssetDto[]) => Promise<void>;
type RotationQueue = {
  photoId: string;
  isCurrent: () => boolean;
  steps: Rotation[];
};
type ImageOverlay = Extract<AssemblyProcedureOverlayElement, { kind: 'IMAGE' }>;

function rotationImages(elements: AssemblyProcedureOverlayElement[], photoId: string) {
  const attachedIds = new Set(findAttachedOverlayIds(elements, photoId));
  return elements.filter((element): element is ImageOverlay =>
    element.kind === 'IMAGE' && (element.id === photoId || attachedIds.has(element.id)));
}

export function useDocumentEditorImageRotation(session: Session) {
  const latest = useRef(session);
  latest.current = session;
  const mounted = useRef(true);
  const active = useRef<RotationQueue | null>(null);
  const [queue, setQueue] = useState<RotationQueue | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const selectedId = session.selectedElement?.id;
  const canQueueRotation = queue != null && queue.photoId === selectedId && queue.isCurrent();
  useEffect(() => {
    const running = active.current;
    if (running && running.photoId !== selectedId && running.steps.length > 1) {
      // Keep the in-flight rotation and discard clicks queued for the previous selection.
      running.steps = running.steps.slice(0, 1);
      setQueue({ ...running });
    }
  }, [selectedId]);

  const rotationPreview = useMemo(() => {
    if (!queue?.steps.length || !canQueueRotation) return null;
    let elements = session.elements;
    const imageAngles = new Map<string, number>();
    for (const { direction, pageAspect } of queue.steps) {
      const images = rotationImages(elements, queue.photoId);
      const rotated = rotateImageOverlay(elements, queue.photoId, direction,
        new Map(images.map(image => [image.id, image.assetId])), pageAspect);
      if (rotated === elements) break;
      elements = rotated;
      for (const image of images) {
        const angle = (imageAngles.get(image.id) ?? 0) + (direction === 'right' ? 90 : -90);
        imageAngles.set(image.id, angle % 360);
      }
    }
    return { elements, imageAngles };
  }, [queue, canQueueRotation, session.elements]);

  const rotateSelectedImage = useCallback(async (
    direction: ImageRotationDirection, pageAspect: number, preloadImages?: PreloadImages
  ) => {
    const current = latest.current;
    const { document, selectedElement: photo, holderToken, materials } = current;
    if (!document || !photo || !isPhoto(photo) || current.readOnly ||
      !(pageAspect > 0 && Number.isFinite(pageAspect))) return;

    const step = { direction, pageAspect };
    const running = active.current;
    if (running) {
      if (running.photoId === photo.id && running.isCurrent()) {
        running.steps = [...running.steps, step];
        setQueue({ ...running });
      }
      return;
    }
    if (current.busy || !photo.assetId || rotationImages(current.elements, photo.id).some(image => !image.assetId)) return;

    const scope = materials.materialScope.current;
    const isCurrent = () => mounted.current && materials.materialScope.current === scope &&
      latest.current.document?.id === document.id && latest.current.document?.editVersion === document.editVersion &&
      latest.current.holderToken === holderToken && !latest.current.readOnly;
    const work: RotationQueue = { photoId: photo.id, isCurrent, steps: [step] };
    active.current = work;
    setQueue({ ...work });
    current.setBusy(true);
    current.setErrorMessage(null);
    // React may batch consecutive results. Use the previous result as the next request's source.
    let elements = current.elements;
    try {
      while (work.steps.length && isCurrent()) {
        const { direction, pageAspect } = work.steps[0];
        const images = rotationImages(elements, photo.id);
        if (images.some(image => !image.assetId)) return;
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
        if (preloadImages) await preloadImages([...assets.values()]);
        if (!isCurrent()) return;

        const newAssetIds = new Map(images.map(image => [image.id, assets.get(image.assetId)!.assetId]));
        const pending = materials.pendingMaterials.current;
        for (const image of images) {
          const placement = pending.get(image.id);
          if (placement && matchesMaterialPlacement(image, placement)) {
            const rotated = assets.get(image.assetId)!;
            const rotatedAssetIds = [...(placement.rotatedAssetIds ?? []), rotated.assetId];
            if (rotated.originalAsset) rotatedAssetIds.push(rotated.originalAsset.assetId);
            pending.set(image.id, { ...placement, rotatedAssetIds });
          }
        }
        const rotatedAssets = [...assets.values()].flatMap(({ originalAsset, ...asset }) =>
          originalAsset ? [asset, originalAsset] : [asset]);
        elements = rotateImageOverlay(elements, photo.id, direction, newAssetIds, pageAspect);
        work.steps = latest.current.selectedElement?.id === photo.id ? work.steps.slice(1) : [];
        // Commit the decoded asset and advance the preview before another click can render.
        flushSync(() => {
          current.setDocument(value => value ? {
            ...value,
            assets: { ...value.assets, ...Object.fromEntries(rotatedAssets.map(asset => [asset.assetId, asset])) }
          } : value);
          current.dispatch({ type: 'rotateImage', id: photo.id, direction, newAssetIds, pageAspect });
          setQueue({ ...work });
        });
      }
    } catch (error) {
      if (isCurrent() && !current.onEditLeaseError(error)) {
        current.setErrorMessage(readAssemblyApiErrorMessage(error, '写真を回せませんでした。'));
      }
    } finally {
      active.current = null;
      if (mounted.current) {
        setQueue(null);
        current.setBusy(false);
      }
    }
  }, []);

  return { rotateSelectedImage, rotationPreview, canQueueRotation };
}
