import { useCallback, useEffect, useRef, useState } from 'react';

import { moveOverlayPage, removeOverlayPage } from './assemblyDocumentEditorDraft';
import {
  assemblyDocumentEditorRecoveryKey,
  clearAssemblyDocumentEditorRecovery,
  readAssemblyDocumentEditorRecovery,
  writeAssemblyDocumentEditorRecovery,
  type AssemblyDocumentEditorRecoveryMatch,
  type AssemblyDocumentEditorRecoveryRecord
} from './assemblyDocumentEditorRecovery';


import type { PendingMaterialPlacement } from './documentEditorMaterialPlacements';
import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

export function useAssemblyDocumentEditorRecovery(input: {
  documentId: string;
  baseUpdatedAt: string | null;
  editVersion: number;
  elements: AssemblyProcedureOverlayElement[];
  materialPlacements?: PendingMaterialPlacement[];
  onDiscardMaterials?: (placements: PendingMaterialPlacement[]) => Promise<void>;
  enabled: boolean;
  dirty: boolean;
  // 話し合い中やドラッグ中は更新が続くので、書き込みを10秒に1回までに間引く
  interacting?: boolean;
  onStorageError?: () => void;
}) {
  const {
    documentId,
    baseUpdatedAt,
    editVersion,
    elements,
    materialPlacements,
    onDiscardMaterials,
    enabled,
    dirty,
    interacting = false,
    onStorageError
  } = input;
  const [pending, setPending] = useState<AssemblyDocumentEditorRecoveryRecord | null>(null);
  const storageErrorShown = useRef(false);
  const pendingAfterPageChange = useRef<AssemblyDocumentEditorRecoveryRecord | null>(null);
  const lastImmediateSave = useRef<AssemblyDocumentEditorRecoveryMatch | null>(null);
  const throttleTimer = useRef<number | null>(null);
  const latestWrite = useRef<() => void>(() => undefined);
  const clearThrottleTimer = useCallback(() => {
    if (throttleTimer.current === null) return;
    window.clearTimeout(throttleTimer.current);
    throttleTimer.current = null;
  }, []);
  useEffect(() => clearThrottleTimer, [clearThrottleTimer]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const saved = lastImmediateSave.current;
    if (saved?.documentId === documentId && saved.baseUpdatedAt === baseUpdatedAt && saved.editVersion === editVersion) {
      // This session just saved the draft; offer recovery only after a reload.
      setPending(current => current === pendingAfterPageChange.current && current?.documentId === documentId && current.baseUpdatedAt === baseUpdatedAt && current.editVersion === editVersion ? current : null);
      return;
    }
    try {
      const stored = readAssemblyDocumentEditorRecovery(window.localStorage, documentId);
      if (stored && (stored.baseUpdatedAt !== baseUpdatedAt || stored.editVersion !== editVersion)) {
        setPending(null);
        void (async () => {
          await onDiscardMaterials?.(stored.materialPlacements ?? []);
          clearAssemblyDocumentEditorRecovery(window.localStorage, documentId);
        })().catch(() => onStorageError?.());
      } else setPending(stored);
    } catch {
      if (!storageErrorShown.current) {
        storageErrorShown.current = true;
        onStorageError?.();
      }
    }
  }, [baseUpdatedAt, documentId, editVersion, enabled, onStorageError, onDiscardMaterials]);

  useEffect(() => {
    if (!enabled || !dirty || typeof window === 'undefined') {
      if (typeof window !== 'undefined') clearThrottleTimer();
      return;
    }
    pendingAfterPageChange.current = null;
    setPending(null);
    const write = () => {
      try {
        writeAssemblyDocumentEditorRecovery(window.localStorage, {
          version: 1,
          documentId,
          baseUpdatedAt,
          editVersion,
          savedAt: new Date().toISOString(),
          elements,
          materialPlacements
        });
      } catch {
        if (!storageErrorShown.current) {
          storageErrorShown.current = true;
          onStorageError?.();
        }
      }
    };
    latestWrite.current = write;
    if (interacting) {
      // 操作中は待ち直さず、10秒の枠の終わりに最新の内容を1回だけ書く
      throttleTimer.current ??= window.setTimeout(() => {
        throttleTimer.current = null;
        latestWrite.current();
      }, 10_000);
      return;
    }
    // 操作が終わったら間引きをやめ、通常の750msで最新を書く
    clearThrottleTimer();
    const timer = window.setTimeout(write, 750);
    return () => window.clearTimeout(timer);
  }, [
    baseUpdatedAt,
    documentId,
    dirty,
    interacting,
    clearThrottleTimer,
    editVersion,
    elements,
    materialPlacements,
    onDiscardMaterials,
    enabled,
    onStorageError
  ]);

  const saveImmediately = useCallback((next: Pick<AssemblyDocumentEditorRecoveryMatch, 'baseUpdatedAt' | 'editVersion'>, flushedElements?: AssemblyProcedureOverlayElement[], placements = materialPlacements) => {
    if (typeof window === 'undefined') return;
    try {
      writeAssemblyDocumentEditorRecovery(window.localStorage, {
        version: 1,
        documentId,
        ...next,
        savedAt: new Date().toISOString(),
        elements: flushedElements ?? elements,
        materialPlacements: placements
      });
      lastImmediateSave.current = { documentId, ...next };
      pendingAfterPageChange.current = null;
      setPending(null);
    } catch {
      if (!storageErrorShown.current) {
        storageErrorShown.current = true;
        onStorageError?.();
      }
    }
  }, [documentId, elements, materialPlacements, onStorageError]);

  useEffect(() => {
    if (!enabled || !dirty) return;
    const save = () => saveImmediately({ baseUpdatedAt, editVersion });
    window.addEventListener('pagehide', save);
    window.addEventListener('beforeunload', save);
    return () => {
      window.removeEventListener('pagehide', save);
      window.removeEventListener('beforeunload', save);
    };
  }, [enabled, dirty, saveImmediately, baseUpdatedAt, editVersion]);

  const clear = () => {
    if (typeof window === 'undefined') return;
    try {
      clearAssemblyDocumentEditorRecovery(window.localStorage, documentId);
      setPending(null);
    } catch {
      if (!storageErrorShown.current) {
        storageErrorShown.current = true;
        onStorageError?.();
      }
    }
  };

  const rebasePending = (adjusted: AssemblyDocumentEditorRecoveryRecord) => {
    saveImmediately({ baseUpdatedAt: adjusted.baseUpdatedAt, editVersion: adjusted.editVersion }, adjusted.elements, adjusted.materialPlacements ?? []);
    // Keep offering the adjusted draft across this session's version change.
    pendingAfterPageChange.current = adjusted;
    setPending(adjusted);
  };

  const importPages = (
    next: Pick<AssemblyDocumentEditorRecoveryMatch, 'baseUpdatedAt' | 'editVersion'>,
    insert: (elements: AssemblyProcedureOverlayElement[]) => AssemblyProcedureOverlayElement[],
    currentElements: AssemblyProcedureOverlayElement[],
    hasUnsavedChanges: boolean
  ) => {
    if (pending) {
      rebasePending({ ...pending, ...next, elements: insert(pending.elements) });
    } else if (hasUnsavedChanges) {
      saveImmediately(next, currentElements);
    }
  };

  const deletePage = (pageIndex: number, next: Pick<AssemblyDocumentEditorRecoveryMatch, 'baseUpdatedAt' | 'editVersion'>, currentElements: AssemblyProcedureOverlayElement[], placements: PendingMaterialPlacement[]) => {
    if (pending) {
      const survivingPages = new Map(currentElements.map(element => [element.id, element.pageIndex]));
      const removedIds = new Set(pending.elements.filter(element => element.pageIndex === pageIndex && !survivingPages.has(element.id)).map(element => element.id));
      const nextElements = removeOverlayPage(pending.elements, pageIndex);
      for (const element of pending.elements) {
        const survivingPage = survivingPages.get(element.id);
        if (element.pageIndex === pageIndex && survivingPage !== undefined) nextElements.push({ ...element, pageIndex: survivingPage });
      }
      const nextPlacements = pending.materialPlacements?.filter(item => !removedIds.has(item.elementId)) ?? [];
      void onDiscardMaterials?.((pending.materialPlacements ?? []).filter(item => removedIds.has(item.elementId))).catch(() => onStorageError?.());
      rebasePending({ ...pending, ...next, elements: nextElements, materialPlacements: nextPlacements });
    } else if (dirty) {
      saveImmediately(next, currentElements, placements);
    }
  };

  const movePage = (
    from: number,
    to: number,
    next: Pick<AssemblyDocumentEditorRecoveryMatch, 'baseUpdatedAt' | 'editVersion'>,
    currentElements: AssemblyProcedureOverlayElement[],
    placements: PendingMaterialPlacement[],
    hasUnsavedChanges: boolean
  ) => {
    if (pending) {
      rebasePending({
        ...pending,
        ...next,
        elements: moveOverlayPage(pending.elements, from, to)
      });
    } else if (hasUnsavedChanges) {
      saveImmediately(next, currentElements, placements);
    }
  };

  const discard = async () => {
    const stored = pending ?? readAssemblyDocumentEditorRecovery(window.localStorage, documentId);
    await onDiscardMaterials?.(stored?.materialPlacements ?? []);
    clear();
  };
  const restore = () => {
    if (!pending) return null;
    setPending(null);
    return pending.elements;
  };

  return {
    pending,
    deletePage,
    movePage,
    importPages,
    restore,
    discard,
    clear,
    saveImmediately,
    storageKey: assemblyDocumentEditorRecoveryKey(documentId)
  };
}
