import { beforeEach, describe, expect, it } from 'vitest';

import {
  assemblyDocumentEditorRecoveryKey,
  readAssemblyDocumentEditorRecovery,
  writeAssemblyDocumentEditorRecovery
} from './assemblyDocumentEditorRecovery';

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
