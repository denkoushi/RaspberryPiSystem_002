import { useEffect, useRef, useState } from 'react';

import {
  assemblyDocumentEditorRecoveryKey,
  clearAssemblyDocumentEditorRecovery,
  readAssemblyDocumentEditorRecovery,
  writeAssemblyDocumentEditorRecovery,
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

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
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
    storageKey: assemblyDocumentEditorRecoveryKey(documentId)
  };
}
