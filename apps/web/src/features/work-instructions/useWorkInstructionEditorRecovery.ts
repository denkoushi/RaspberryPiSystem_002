import { useEffect, useRef, useState } from 'react';

import {
  clearWorkInstructionEditorRecovery,
  readWorkInstructionEditorRecovery,
  workInstructionEditorRecoveryKey,
  writeWorkInstructionEditorRecovery,
  type WorkInstructionEditorRecoveryRecord
} from './workInstructionEditorRecovery';

import type { WorkInstructionOverlayElement } from '../../api/domains/work-instructions';

export function useWorkInstructionEditorRecovery(input: {
  groupKey: string;
  revisionId: string | null;
  sourceVersionId: string | null;
  sourceContentHash: string | null;
  editVersion: number;
  elements: WorkInstructionOverlayElement[];
  enabled: boolean;
  dirty: boolean;
  onStorageError?: () => void;
}) {
  const {
    groupKey,
    revisionId,
    sourceVersionId,
    sourceContentHash,
    editVersion,
    elements,
    enabled,
    dirty,
    onStorageError
  } = input;
  const [pending, setPending] = useState<WorkInstructionEditorRecoveryRecord | null>(null);
  const storageErrorShown = useRef(false);

  useEffect(() => {
    if (!enabled || !revisionId || !sourceVersionId || !sourceContentHash || typeof window === 'undefined') return;
    try {
      setPending(readWorkInstructionEditorRecovery(window.localStorage, groupKey, revisionId, {
        sourceVersionId,
        sourceContentHash,
        editVersion
      }));
    } catch {
      if (!storageErrorShown.current) {
        storageErrorShown.current = true;
        onStorageError?.();
      }
    }
  }, [editVersion, enabled, groupKey, onStorageError, revisionId, sourceContentHash, sourceVersionId]);

  useEffect(() => {
    if (!enabled || !dirty || !revisionId || !sourceVersionId || !sourceContentHash || typeof window === 'undefined') return;
    const timer = window.setTimeout(() => {
      try {
        writeWorkInstructionEditorRecovery(window.localStorage, {
          version: 1,
          groupKey,
          revisionId,
          sourceVersionId,
          sourceContentHash,
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
  }, [dirty, editVersion, elements, enabled, groupKey, onStorageError, revisionId, sourceContentHash, sourceVersionId]);

  const clear = () => {
    if (!revisionId || typeof window === 'undefined') return;
    try {
      clearWorkInstructionEditorRecovery(window.localStorage, groupKey, revisionId);
      setPending(null);
    } catch {
      if (!storageErrorShown.current) {
        storageErrorShown.current = true;
        onStorageError?.();
      }
    }
  };

  return {
    pending,
    restore: () => {
      if (!pending) return null;
      setPending(null);
      return pending.elements;
    },
    discard: clear,
    clear,
    storageKey: revisionId ? workInstructionEditorRecoveryKey(groupKey, revisionId) : null
  };
}
