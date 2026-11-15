import { useCallback, useEffect, useRef, useState } from 'react';

import { unplaceProcedureMaterial } from '../../../api/client';
import { api } from '../../../api/http';

import { readAssemblyDocumentEditorRecovery, writeAssemblyDocumentEditorRecovery } from './assemblyDocumentEditorRecovery';
import { matchesMaterialPlacement, removeMaterialPlacements, type PendingMaterialPlacement } from './documentEditorMaterialPlacements';

import type { OverlayHistoryAction } from './documentEditorHistory';
import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

export function useDocumentEditorMaterialPlacements({ documentId, elements, dispatch, setErrorMessage }: {
  documentId: string;
  elements: AssemblyProcedureOverlayElement[];
  dispatch: (action: OverlayHistoryAction) => void;
  setErrorMessage: (message: string) => void;
}) {
  const mounted = useRef(true);
  const pendingMaterials = useRef(new Map<string, PendingMaterialPlacement>());
  const releasedMaterials = useRef<PendingMaterialPlacement[]>([]);
  const materialDocumentId = useRef(documentId);
  materialDocumentId.current = documentId;
  const [materialRevision, setMaterialRevision] = useState(0);
  const materialScope = useRef(0);
  const unplacements = useRef(new Map<string, Promise<boolean>>());
  const releaseMaterials = useCallback((placements: PendingMaterialPlacement[], replacement?: AssemblyProcedureOverlayElement, removeFromDraft = true, preserveHistory = false) => {
    if (preserveHistory) releasedMaterials.current.push(...placements);
    for (const placement of placements) {
      if (pendingMaterials.current.get(placement.elementId) === placement) pendingMaterials.current.delete(placement.elementId);
    }
    if (mounted.current && removeFromDraft && placements.length) dispatch({ type: 'releaseMaterials', placements, replacement, preserveHistory });
    if (removeFromDraft && placements.length) {
      try {
        const stored = readAssemblyDocumentEditorRecovery(window.localStorage, materialDocumentId.current);
        if (stored) writeAssemblyDocumentEditorRecovery(window.localStorage, {
          ...stored,
          elements: removeMaterialPlacements(stored.elements, placements),
          materialPlacements: stored.materialPlacements?.filter(item => !placements.some(placement => placement.elementId === item.elementId && placement.materialId === item.materialId))
        });
      } catch {
        if (mounted.current) setErrorMessage('端末の下書き領域へ保存できませんでした。明示保存を行ってください。');
      }
    }
    const materialIds = [...new Set(placements.map(item => item.materialId))].filter(id => ![...pendingMaterials.current.values()].some(item => item.materialId === id));
    return Promise.all(materialIds.map(id => {
      const existing = unplacements.current.get(id);
      if (existing) return existing;
      const request = unplaceProcedureMaterial(id).then(() => { if (mounted.current) setMaterialRevision(value => value + 1); return true; }).catch(() => {
        if (mounted.current) setErrorMessage('素材を未配置に戻せませんでした。素材棚で配置を取り消してください。');
        return false;
      }).finally(() => { unplacements.current.delete(id); });
      unplacements.current.set(id, request);
      return request;
    })).then(results => results.every(Boolean));
  }, [setErrorMessage, dispatch]);
  const releaseAllMaterials = useCallback(() => {
    materialScope.current += 1;
    if (mounted.current && releasedMaterials.current.length) dispatch({ type: 'releaseMaterials', placements: releasedMaterials.current });
    releasedMaterials.current = [];
    const placements = [...pendingMaterials.current.values()];
    const release = releaseMaterials(placements);
    return { placements, done: Promise.all([release, ...unplacements.current.values()]).then(results => results.every(Boolean)) };
  }, [releaseMaterials, dispatch]);
  const beforeMaterialPlacement = useCallback(async (id: string) => { await unplacements.current.get(id); }, []);
  const cancelMaterialPlacement = useCallback((materialId: string, element: AssemblyProcedureOverlayElement) => {
    void releaseMaterials([{ materialId, elementId: element.id, ...(element.kind === 'IMAGE' ? { assetId: element.assetId } : {}) }]);
  }, [releaseMaterials]);
  const trackMaterialPlacement = useCallback((materialId: string, element: AssemblyProcedureOverlayElement, scope: number, replaced?: AssemblyProcedureOverlayElement) => {
    const previous = pendingMaterials.current.get(element.id);
    const placement: PendingMaterialPlacement = {
      elementId: element.id, materialId,
      ...(element.kind === 'IMAGE' ? { assetId: element.assetId } : {}),
      ...(previous ? { fallbackAssetId: previous.fallbackAssetId } : replaced?.kind === 'IMAGE' ? { fallbackAssetId: replaced.assetId } : {})
    };
    if (scope !== materialScope.current) {
      void releaseMaterials([placement]);
      return false;
    }
    pendingMaterials.current.set(element.id, placement);
    if (previous) void releaseMaterials([previous], element);
    return true;
  }, [releaseMaterials]);
  const markMaterialsPlaced = useCallback(() => setMaterialRevision(value => value + 1), []);
  const commitMaterialPlacements = useCallback(() => {
    const committedIds = new Set([...pendingMaterials.current.values()].map(item => item.materialId));
    releasedMaterials.current = releasedMaterials.current.filter(item => !committedIds.has(item.materialId));
    pendingMaterials.current.clear();
  }, []);
  useEffect(() => {
    const removed = [...pendingMaterials.current.values()].filter(placement => !elements.some(element => matchesMaterialPlacement(element, placement)));
    if (removed.length) void releaseMaterials(removed, undefined, true, true);
  }, [elements, releaseMaterials]);
  useEffect(() => {
    mounted.current = true;
    const pending = pendingMaterials.current;
    let hidden = false;
    const pagehide = () => {
      if (hidden) return;
      hidden = true;
      materialScope.current += 1;
      const placements = [...pendingMaterials.current.values()];
      // Keep the recovery record intact: its discard action retries a lost request.
      for (const id of new Set(placements.map(item => item.materialId))) {
        void api.post(`/assembly/procedure-materials/${encodeURIComponent(id)}/unplace`, undefined, {
          adapter: 'fetch', fetchOptions: { keepalive: true }
        }).catch(() => undefined);
      }
    };
    const pageshow = (event: PageTransitionEvent) => {
      if (event.persisted && hidden) { hidden = false; void releaseAllMaterials().done; }
    };
    window.addEventListener('pagehide', pagehide);
    window.addEventListener('pageshow', pageshow);
    return () => {
      window.removeEventListener('pagehide', pagehide);
      window.removeEventListener('pageshow', pageshow);
      mounted.current = false;
      if (hidden) pending.clear();
      void releaseAllMaterials().done;
    };
  }, [releaseAllMaterials, dispatch]);
  const materialPlacements = useRef<PendingMaterialPlacement[]>([]);
  const placements = [...pendingMaterials.current.values()];
  if (placements.length !== materialPlacements.current.length || placements.some((item, index) => item !== materialPlacements.current[index])) materialPlacements.current = placements;
  const discardMaterialPlacements = useCallback(async (placements: PendingMaterialPlacement[]) => { await releaseMaterials(placements, undefined, false); }, [releaseMaterials]);
  return { pendingMaterials, releasedMaterials, markMaterialsPlaced, materialRevision, materialScope, materialPlacements: materialPlacements.current, releaseAllMaterials, beforeMaterialPlacement, cancelMaterialPlacement, trackMaterialPlacement, commitMaterialPlacements, discardMaterialPlacements };
}
