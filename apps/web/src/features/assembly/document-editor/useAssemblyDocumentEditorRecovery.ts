import { useCallback, useEffect, useRef, useState } from 'react';

import {
  assemblyDocumentEditorRecoveryKey,
  clearAssemblyDocumentEditorRecovery,
  readAssemblyDocumentEditorRecovery,
  writeAssemblyDocumentEditorRecovery,
  type AssemblyDocumentEditorRecoveryMatch,
  type AssemblyDocumentEditorRecoveryRecord
} from './assemblyDocumentEditorRecovery';

import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

export function useAssemblyDocumentEditorRecovery(input: {
  documentId: string;
  baseUpdatedAt: string | null;
  editVersion: number;
  elements: AssemblyProcedureOverlayElement[];
  enabled: boolean;
  dirty: boolean;
  onStorageError?: () => void;
}) {
  const {
    documentId,
    baseUpdatedAt,
    editVersion,
    elements,
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
      setPending(
        readAssemblyDocumentEditorRecovery(window.localStorage, documentId, {
          baseUpdatedAt,
          editVersion
        })
      );
    } catch {
      if (!storageErrorShown.current) {
        storageErrorShown.current = true;
        onStorageError?.();
      }
    }
  }, [baseUpdatedAt, documentId, editVersion, enabled, onStorageError]);

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
          elements
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
    enabled,
    onStorageError
  ]);

  const saveImmediately = useCallback((next: Pick<AssemblyDocumentEditorRecoveryMatch, 'baseUpdatedAt' | 'editVersion'>) => {
    if (typeof window === 'undefined') return;
    try {
      writeAssemblyDocumentEditorRecovery(window.localStorage, {
        version: 1,
        documentId,
        ...next,
        savedAt: new Date().toISOString(),
        elements
      });
      lastImmediateSave.current = { documentId, ...next };
    } catch {
      if (!storageErrorShown.current) {
        storageErrorShown.current = true;
        onStorageError?.();
      }
    }
  }, [documentId, elements, onStorageError]);

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

  const discard = () => clear();
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
