import { useCallback, useEffect, useRef, useState } from 'react';

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
    onStorageError
  } = input;
  const [pending, setPending] = useState<AssemblyDocumentEditorRecoveryRecord | null>(null);
  const storageErrorShown = useRef(false);
  const lastImmediateSave = useRef<AssemblyDocumentEditorRecoveryMatch | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const saved = lastImmediateSave.current;
    if (saved?.documentId === documentId && saved.baseUpdatedAt === baseUpdatedAt && saved.editVersion === editVersion) {
      // This session just saved the draft; offer recovery only after a reload.
      setPending(null);
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
    if (!enabled || !dirty || typeof window === 'undefined') return;
    const timer = window.setTimeout(() => {
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
    }, 750);
    return () => window.clearTimeout(timer);
  }, [
    baseUpdatedAt,
    documentId,
    dirty,
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
    restore,
    discard,
    clear,
    saveImmediately,
    storageKey: assemblyDocumentEditorRecoveryKey(documentId)
  };
}
