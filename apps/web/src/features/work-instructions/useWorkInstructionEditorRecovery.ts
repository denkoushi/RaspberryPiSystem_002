import { useEffect, useRef, useState } from 'react';

import {
  clearWorkInstructionEditorRecovery,
  readWorkInstructionEditorRecovery,
  workInstructionEditorRecoveryKey,
  writeWorkInstructionEditorRecovery,
  type WorkInstructionEditorRecoveryRecord
} from './workInstructionEditorRecovery';

import type { WorkInstructionMemoOverrideDto } from '../../api/domains/work-instruction-overlays';
import type { WorkInstructionOverlayElement } from '../../api/domains/work-instructions';

export function useWorkInstructionEditorRecovery(input: {
  groupKey: string;
  revisionId: string | null;
  sourceVersionId: string | null;
  sourceContentHash: string | null;
  editVersion: number;
  elements: WorkInstructionOverlayElement[];
  memoOverrides: WorkInstructionMemoOverrideDto[];
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
    memoOverrides,
    enabled,
    dirty,
    onStorageError
  } = input;
  const [pending, setPending] = useState<WorkInstructionEditorRecoveryRecord | null>(null);
  const storageErrorShown = useRef(false);
  const onStorageErrorRef = useRef(onStorageError);
  const readIdentityRef = useRef<string | null>(null);
  const consumedIdentityRef = useRef<string | null>(null);
  onStorageErrorRef.current = onStorageError;
  const identity = revisionId && sourceVersionId && sourceContentHash
    ? `${groupKey}:${revisionId}:${sourceVersionId}:${sourceContentHash}:${editVersion}`
    : null;

  useEffect(() => {
    if (!enabled || !identity || !revisionId || !sourceVersionId || !sourceContentHash || typeof window === 'undefined') return;
    if (readIdentityRef.current === identity || consumedIdentityRef.current === identity) return;
    readIdentityRef.current = identity;
    try {
      setPending(readWorkInstructionEditorRecovery(window.localStorage, groupKey, revisionId, {
        sourceVersionId,
        sourceContentHash,
        editVersion
      }));
    } catch {
      if (!storageErrorShown.current) {
        storageErrorShown.current = true;
        onStorageErrorRef.current?.();
      }
    }
  }, [editVersion, enabled, groupKey, identity, revisionId, sourceContentHash, sourceVersionId]);

  useEffect(() => {
    if (!enabled || !dirty || !revisionId || !sourceVersionId || !sourceContentHash || typeof window === 'undefined') return;
    const timer = window.setTimeout(() => {
      try {
        writeWorkInstructionEditorRecovery(window.localStorage, {
          version: 2,
          groupKey,
          revisionId,
          sourceVersionId,
          sourceContentHash,
          editVersion,
          savedAt: new Date().toISOString(),
          elements,
          memoOverrides
        });
      } catch {
        if (!storageErrorShown.current) {
          storageErrorShown.current = true;
          onStorageErrorRef.current?.();
        }
      }
    }, 750);
    return () => window.clearTimeout(timer);
  }, [dirty, editVersion, elements, enabled, groupKey, memoOverrides, revisionId, sourceContentHash, sourceVersionId]);

  const clear = () => {
    if (!revisionId || typeof window === 'undefined') return;
    try {
      clearWorkInstructionEditorRecovery(window.localStorage, groupKey, revisionId);
      setPending(null);
      if (identity) consumedIdentityRef.current = identity;
    } catch {
      if (!storageErrorShown.current) {
        storageErrorShown.current = true;
        onStorageErrorRef.current?.();
      }
    }
  };

  return {
    pending,
    restore: () => {
      if (!pending) return null;
      setPending(null);
      if (identity) consumedIdentityRef.current = identity;
      return {
        elements: pending.elements,
        // v1 has no memo snapshot: callers must retain server memo state.
        memoOverrides: pending.version === 2 ? pending.memoOverrides ?? [] : null
      };
    },
    discard: clear,
    clear,
    storageKey: revisionId ? workInstructionEditorRecoveryKey(groupKey, revisionId) : null
  };
}
