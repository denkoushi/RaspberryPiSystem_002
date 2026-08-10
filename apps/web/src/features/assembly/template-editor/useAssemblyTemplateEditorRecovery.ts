import { useEffect, useRef, useState } from 'react';

import {
  buildAssemblyTemplateEditorRecoveryKey,
  createAssemblyTemplateEditorRecoveryRecord,
  isAssemblyTemplateEditorRecoveryCompatible
} from '../assemblyTemplateEditorRecovery';
import {
  clearAssemblyTemplateEditorRecovery,
  readAssemblyTemplateEditorRecovery,
  writeAssemblyTemplateEditorRecovery
} from '../assemblyTemplateEditorRecoveryStorage';

import type {
  AssemblyTemplateEditorRecoveryDraft,
  AssemblyTemplateEditorRecoveryV1
} from '../assemblyTemplateEditorRecovery';

type RecoveryDecision = 'unchecked' | 'pending' | 'resolved';

export function useAssemblyTemplateEditorRecovery(input: {
  accessGranted: boolean;
  initialized: boolean;
  readOnly: boolean;
  isDirty: boolean;
  mode: 'new' | 'revise';
  templateId?: string;
  isActive: boolean;
  sourceTemplateId?: string | null;
  procedureDocumentId?: string | null;
  baseUpdatedAt?: string | null;
  draft: AssemblyTemplateEditorRecoveryDraft;
  restoreDraft: (draft: AssemblyTemplateEditorRecoveryDraft) => void;
  onStorageError: () => void;
}) {
  const [pending, setPending] = useState<AssemblyTemplateEditorRecoveryV1 | null>(null);
  const [decision, setDecision] = useState<RecoveryDecision>('unchecked');
  const [checkedKey, setCheckedKey] = useState<string | null>(null);
  const storageErrorShown = useRef(false);
  const targetKey = buildAssemblyTemplateEditorRecoveryKey({
    mode: input.mode,
    templateId: input.templateId,
    sourceTemplateId: input.sourceTemplateId,
    procedureDocumentId: input.procedureDocumentId
  });

  useEffect(() => {
    if (!input.accessGranted || !input.initialized || input.readOnly) return;
    if (checkedKey === targetKey) return;
    setCheckedKey(targetKey);
    setPending(null);
    setDecision('resolved');
    try {
      const record = readAssemblyTemplateEditorRecovery(localStorage, targetKey);
      if (
        record &&
        isAssemblyTemplateEditorRecoveryCompatible(record, {
          mode: input.mode,
          targetKey,
          templateId: input.templateId,
          updatedAt: input.baseUpdatedAt,
          isActive: input.isActive,
          currentModelCode: input.mode === 'revise' ? input.draft.modelCode : undefined,
          currentProcedurePattern:
            input.mode === 'revise' ? input.draft.procedurePattern : undefined
        })
      ) {
        setPending(record);
        setDecision('pending');
      } else if (record) {
        clearAssemblyTemplateEditorRecovery(localStorage, targetKey);
      }
    } catch {
      if (!storageErrorShown.current) {
        storageErrorShown.current = true;
        input.onStorageError();
      }
    }
  // The hook input is intentionally split into stable scalar dependencies; the object itself is recreated by the controller.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    checkedKey,
    input.accessGranted,
    input.baseUpdatedAt,
    input.initialized,
    input.mode,
    input.onStorageError,
    input.procedureDocumentId,
    input.readOnly,
    input.sourceTemplateId,
    input.templateId,
    targetKey
  ]);

  useEffect(() => {
    if (
      !input.accessGranted ||
      !input.initialized ||
      input.readOnly ||
      !input.isDirty ||
      decision !== 'resolved' ||
      checkedKey !== targetKey
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      try {
        writeAssemblyTemplateEditorRecovery(
          localStorage,
          targetKey,
          createAssemblyTemplateEditorRecoveryRecord({
            mode: input.mode,
            targetKey,
            baseTemplateId: input.templateId ?? null,
            baseUpdatedAt: input.baseUpdatedAt ?? null,
            draft: input.draft
          })
        );
      } catch {
        if (!storageErrorShown.current) {
          storageErrorShown.current = true;
          input.onStorageError();
        }
      }
    }, 750);
    return () => window.clearTimeout(timer);
  // The draft object is the debounce boundary; adding the whole input object would reset it on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    checkedKey,
    decision,
    input.accessGranted,
    input.baseUpdatedAt,
    input.draft,
    input.initialized,
    input.isDirty,
    input.mode,
    input.onStorageError,
    input.readOnly,
    input.templateId,
    targetKey
  ]);

  const restore = () => {
    if (!pending) return;
    input.restoreDraft(pending.draft);
    setPending(null);
    setDecision('resolved');
  };

  const discard = () => {
    try {
      clearAssemblyTemplateEditorRecovery(localStorage, targetKey);
    } catch {
      if (!storageErrorShown.current) {
        storageErrorShown.current = true;
        input.onStorageError();
      }
    }
    setPending(null);
    setDecision('resolved');
  };

  const clear = () => {
    try {
      clearAssemblyTemplateEditorRecovery(localStorage, targetKey);
    } catch {
      if (!storageErrorShown.current) {
        storageErrorShown.current = true;
        input.onStorageError();
      }
    }
  };

  return { clear, discard, pending, restore, targetKey };
}
