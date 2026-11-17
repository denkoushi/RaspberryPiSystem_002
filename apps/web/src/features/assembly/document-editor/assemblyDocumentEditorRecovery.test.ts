import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assemblyDocumentEditorRecoveryKey,
  readAssemblyDocumentEditorRecovery,
  writeAssemblyDocumentEditorRecovery
} from './assemblyDocumentEditorRecovery';
import { useAssemblyDocumentEditorRecovery } from './useAssemblyDocumentEditorRecovery';

const elements = [
  {
    id: 'overlay-1',
    pageIndex: 0,
    kind: 'TEXT' as const,
    text: '復旧',
    bbox: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.1 },
    zIndex: 0
  }
];

describe('assembly document editor recovery identity', () => {
  beforeEach(() => window.localStorage.clear());

  it('keys records by the actual editable document and retains version metadata', () => {
    writeAssemblyDocumentEditorRecovery(window.localStorage, {
      version: 1,
      documentId: 'revision-v2',
      baseUpdatedAt: '2026-08-21T00:00:00.000Z',
      editVersion: 3,
      savedAt: '2026-08-21T00:01:00.000Z',
      elements
    });

    expect(window.localStorage.getItem(assemblyDocumentEditorRecoveryKey('revision-v2'))).toContain('revision-v2');
    expect(window.localStorage.getItem(assemblyDocumentEditorRecoveryKey('source-v1'))).toBeNull();
    expect(
      readAssemblyDocumentEditorRecovery(window.localStorage, 'revision-v2', {
        baseUpdatedAt: '2026-08-21T00:00:00.000Z',
        editVersion: 3
      })
    ).toMatchObject({ documentId: 'revision-v2', editVersion: 3, baseUpdatedAt: '2026-08-21T00:00:00.000Z' });
  });

  it('does not mix a stale editVersion or updatedAt record into a later revision', () => {
    writeAssemblyDocumentEditorRecovery(window.localStorage, {
      version: 1,
      documentId: 'revision-v2',
      baseUpdatedAt: '2026-08-21T00:00:00.000Z',
      editVersion: 3,
      savedAt: '2026-08-21T00:01:00.000Z',
      elements
    });

    expect(
      readAssemblyDocumentEditorRecovery(window.localStorage, 'revision-v2', {
        baseUpdatedAt: '2026-08-21T00:00:00.000Z',
        editVersion: 4
      })
    ).toBeNull();
    expect(
      readAssemblyDocumentEditorRecovery(window.localStorage, 'revision-v2', {
        baseUpdatedAt: '2026-08-21T00:02:00.000Z',
        editVersion: 3
      })
    ).toBeNull();
  });
});


describe('page deletion recovery lifecycle', () => {
  beforeEach(() => localStorage.clear());
  const base = { documentId: 'doc', baseUpdatedAt: 'old', editVersion: 0, elements, enabled: true, dirty: false };
  const next = { baseUpdatedAt: 'new', editVersion: 1 };

  it('does not save a clean editor on page deletion', () => {
    const hook = renderHook(() => useAssemblyDocumentEditorRecovery(base));
    act(() => hook.result.current.deletePage(1, next, elements, []));
    expect(readAssemblyDocumentEditorRecovery(localStorage, 'doc')).toBeNull();
  });

  it('adjusts a pending candidate even when clean and keeps only surviving materials', () => {
    const deleted = { ...elements[0], id: 'deleted', pageIndex: 1 };
    writeAssemblyDocumentEditorRecovery(localStorage, { version: 1, ...base, savedAt: 'now', elements: [...elements, deleted], materialPlacements: [{ elementId: deleted.id, materialId: 'removed' }, { elementId: elements[0].id, materialId: 'kept' }] });
    const onDiscardMaterials = vi.fn().mockResolvedValue(undefined);
    const hook = renderHook(props => useAssemblyDocumentEditorRecovery({ ...props, onDiscardMaterials }), { initialProps: base });
    act(() => hook.result.current.deletePage(1, next, [], []));
    hook.rerender({ ...base, ...next });
    expect(hook.result.current.pending).toMatchObject({ ...next, elements, materialPlacements: [{ elementId: elements[0].id, materialId: 'kept' }] });
    expect(onDiscardMaterials).toHaveBeenCalledExactlyOnceWith([{ elementId: deleted.id, materialId: 'removed' }]);
    expect(readAssemblyDocumentEditorRecovery(localStorage, 'doc')).toMatchObject({ ...next, elements });
  });

  it('keeps a material already moved to a surviving page out of pending cleanup', () => {
    writeAssemblyDocumentEditorRecovery(localStorage, { version: 1, ...base, savedAt: 'now', elements, materialPlacements: [{ elementId: elements[0].id, materialId: 'kept' }] });
    const onDiscardMaterials = vi.fn().mockResolvedValue(undefined);
    const hook = renderHook(() => useAssemblyDocumentEditorRecovery({ ...base, onDiscardMaterials }));
    act(() => hook.result.current.deletePage(0, next, elements, [{ elementId: elements[0].id, materialId: 'kept' }]));
    expect(hook.result.current.pending?.elements).toEqual(elements);
    expect(hook.result.current.pending?.materialPlacements).toEqual([{ elementId: elements[0].id, materialId: 'kept' }]);
    expect(onDiscardMaterials).toHaveBeenCalledExactlyOnceWith([]);
  });

  it('clears an adjusted candidate when current edits are autosaved', () => {
    vi.useFakeTimers();
    try {
      writeAssemblyDocumentEditorRecovery(localStorage, { version: 1, ...base, savedAt: 'now', elements });
      const hook = renderHook(props => useAssemblyDocumentEditorRecovery(props), { initialProps: base });
      act(() => hook.result.current.deletePage(1, next, elements, []));
      hook.rerender({ ...base, ...next, dirty: true, elements: [{ ...elements[0], text: 'current edit' }] });
      // The old candidate must be unavailable even before the debounce writes.
      expect(hook.result.current.pending).toBeNull();
      act(() => vi.advanceTimersByTime(750));
      expect(hook.result.current.pending).toBeNull();
      expect(hook.result.current.restore()).toBeNull();
      expect(readAssemblyDocumentEditorRecovery(localStorage, 'doc')?.elements[0]).toMatchObject({ text: 'current edit' });
      hook.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([false, true])('clears a stale candidate on an ordinary immediate save (after deletion: %s)', afterDeletion => {
    writeAssemblyDocumentEditorRecovery(localStorage, { version: 1, ...base, savedAt: 'now', elements });
    const hook = renderHook(props => useAssemblyDocumentEditorRecovery(props), { initialProps: base });
    expect(hook.result.current.pending).not.toBeNull();
    if (afterDeletion) {
      act(() => hook.result.current.deletePage(1, next, elements, []));
      hook.rerender({ ...base, ...next });
      expect(hook.result.current.pending).not.toBeNull();
    }
    const edited = [{ ...elements[0], text: 'current edit' }];
    act(() => hook.result.current.saveImmediately(next, edited));
    hook.rerender({ ...base, ...next, elements: edited });
    expect(hook.result.current.pending).toBeNull();
    expect(hook.result.current.restore()).toBeNull();
    expect(readAssemblyDocumentEditorRecovery(localStorage, 'doc')?.elements).toEqual(edited);
  });

  it('does not retain the adjusted candidate for another document with matching version metadata', () => {
    writeAssemblyDocumentEditorRecovery(localStorage, { version: 1, ...base, savedAt: 'now', elements });
    const hook = renderHook(props => useAssemblyDocumentEditorRecovery(props), { initialProps: base });
    act(() => hook.result.current.deletePage(1, next, elements, []));
    hook.rerender({ ...base, ...next, documentId: 'other' });
    expect(hook.result.current.pending).toBeNull();
  });
});
