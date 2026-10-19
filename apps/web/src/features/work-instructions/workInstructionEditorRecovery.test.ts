import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearWorkInstructionEditorRecovery,
  readWorkInstructionEditorRecovery,
  workInstructionEditorRecoveryKey,
  writeWorkInstructionEditorRecovery
} from './workInstructionEditorRecovery';

import type { WorkInstructionEditorRecoveryRecord } from './workInstructionEditorRecovery';

const expected = {
  sourceVersionId: 'source-version-1',
  sourceContentHash: 'source-hash',
  editVersion: 3
};

const elements = [{
  id: 'overlay-1',
  pageIndex: 0,
  bbox: { xRatio: 0, yRatio: 0, widthRatio: 0.2, heightRatio: 0.1 },
  zIndex: 0,
  kind: 'TEXT' as const,
  text: '注記'
}];

describe('work instruction editor recovery records', () => {
  beforeEach(() => window.localStorage.clear());

  it('reads a v1 record without replacing server-projected memos', () => {
    const record: WorkInstructionEditorRecoveryRecord = {
      version: 1,
      groupKey: 'PART-1:加工',
      revisionId: 'revision-1',
      ...expected,
      savedAt: '2026-09-01T00:00:00.000Z',
      elements
    };
    writeWorkInstructionEditorRecovery(window.localStorage, record);

    const recovered = readWorkInstructionEditorRecovery(window.localStorage, record.groupKey, record.revisionId, expected);
    expect(recovered).toEqual(record);
    expect(recovered?.memoOverrides).toBeUndefined();
  });

  it('round-trips a v2 memo snapshot including an empty override', () => {
    const record: WorkInstructionEditorRecoveryRecord = {
      version: 2,
      groupKey: 'PART-1:加工',
      revisionId: 'revision-1',
      ...expected,
      savedAt: '2026-09-01T00:00:00.000Z',
      elements,
      memoOverrides: [{ stepKey: 'sp:list:1:1', text: '' }]
    };
    writeWorkInstructionEditorRecovery(window.localStorage, record);

    expect(readWorkInstructionEditorRecovery(window.localStorage, record.groupKey, record.revisionId, expected)).toEqual(record);
    expect(window.localStorage.getItem(workInstructionEditorRecoveryKey(record.groupKey, record.revisionId))).toContain('memoOverrides');
  });

  it('rejects stale records and clears them explicitly', () => {
    const record: WorkInstructionEditorRecoveryRecord = {
      version: 2,
      groupKey: 'PART-1:加工',
      revisionId: 'revision-1',
      ...expected,
      savedAt: '2026-09-01T00:00:00.000Z',
      elements,
      memoOverrides: []
    };
    writeWorkInstructionEditorRecovery(window.localStorage, record);

    expect(readWorkInstructionEditorRecovery(window.localStorage, record.groupKey, record.revisionId, {
      ...expected,
      editVersion: expected.editVersion + 1
    })).toBeNull();
    clearWorkInstructionEditorRecovery(window.localStorage, record.groupKey, record.revisionId);
    expect(window.localStorage.getItem(workInstructionEditorRecoveryKey(record.groupKey, record.revisionId))).toBeNull();
  });
});
