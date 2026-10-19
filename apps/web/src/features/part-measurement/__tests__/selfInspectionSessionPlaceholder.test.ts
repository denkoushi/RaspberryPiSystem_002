import { describe, expect, it } from 'vitest';

import {
  consumeSelfInspectionSeededEntry,
  isSelfInspectionSessionSeedPending,
  resolveSelfInspectionSessionPlaceholderData,
  resolveSelfInspectionUnsavedEntryInitialData
} from '../selfInspectionSessionPlaceholder';

import type { SelfInspectionSessionDetailDto } from '../types';

function sessionWithId(id: string): SelfInspectionSessionDetailDto {
  return { id } as SelfInspectionSessionDetailDto;
}

describe('resolveSelfInspectionSessionPlaceholderData', () => {
  it('returns previous data only when session id matches', () => {
    const previous = sessionWithId('session-a');
    expect(resolveSelfInspectionSessionPlaceholderData(previous, 'session-a')).toBe(previous);
  });

  it('returns undefined when session id changes', () => {
    const previous = sessionWithId('session-a');
    expect(resolveSelfInspectionSessionPlaceholderData(previous, 'session-b')).toBeUndefined();
  });

  it('returns undefined when previous data is missing', () => {
    expect(resolveSelfInspectionSessionPlaceholderData(undefined, 'session-a')).toBeUndefined();
  });
});

function sessionWithEntries(id: string, entryIndexes: number[], focusedEntryIndex: number | null = null): SelfInspectionSessionDetailDto {
  return {
    id,
    entries: entryIndexes.map((entryIndex) => ({ entryIndex })),
    focusedEntry: focusedEntryIndex == null ? null : { entryIndex: focusedEntryIndex }
  } as unknown as SelfInspectionSessionDetailDto;
}

describe('resolveSelfInspectionUnsavedEntryInitialData', () => {
  it('seeds an unsaved entry from the newest cached query of the same session without a focused entry', () => {
    const older = sessionWithEntries('session-a', [0], 0);
    const newer = sessionWithEntries('session-a', [0, 1], 1);
    const result = resolveSelfInspectionUnsavedEntryInitialData(
      [
        { data: older, updatedAt: 100 },
        { data: newer, updatedAt: 200 },
        { data: sessionWithEntries('session-b', []), updatedAt: 300 }
      ],
      'session-a',
      2
    );
    expect(result?.updatedAt).toBe(200);
    expect(result?.data.entries).toBe(newer.entries);
    expect(result?.data.focusedEntry).toBeNull();
  });

  it('does not seed an entry that is already saved on the server', () => {
    const cached = [{ data: sessionWithEntries('session-a', [0, 1], 0), updatedAt: 100 }];
    expect(resolveSelfInspectionUnsavedEntryInitialData(cached, 'session-a', 1)).toBeUndefined();
  });

  it('does not seed without a same-session cache, session id, or entry index', () => {
    const cached = [{ data: sessionWithEntries('session-b', []), updatedAt: 100 }];
    expect(resolveSelfInspectionUnsavedEntryInitialData(cached, 'session-a', 0)).toBeUndefined();
    expect(resolveSelfInspectionUnsavedEntryInitialData([], 'session-a', 0)).toBeUndefined();
    expect(resolveSelfInspectionUnsavedEntryInitialData(cached, null, 0)).toBeUndefined();
    expect(resolveSelfInspectionUnsavedEntryInitialData(cached, 'session-b', undefined)).toBeUndefined();
  });
});

describe('isSelfInspectionSessionSeedPending', () => {
  it('is pending only for initial data that has not been fetched or set yet', () => {
    expect(isSelfInspectionSessionSeedPending({ data: {}, dataUpdateCount: 0 })).toBe(true);
    expect(isSelfInspectionSessionSeedPending({ data: {}, dataUpdateCount: 1 })).toBe(false);
    expect(isSelfInspectionSessionSeedPending({ data: undefined, dataUpdateCount: 0 })).toBe(false);
    expect(isSelfInspectionSessionSeedPending(undefined)).toBe(false);
  });
});

describe('consumeSelfInspectionSeededEntry', () => {
  it('rebinds a seeded entry saved elsewhere even after switching away before its fetch finished', () => {
    const seeded = new Set<string>();
    expect(consumeSelfInspectionSeededEntry(seeded, { entryKey: 's:0', isSeedPending: true, isSavedOnServer: false })).toBe('none');
    expect(consumeSelfInspectionSeededEntry(seeded, { entryKey: 's:1', isSeedPending: true, isSavedOnServer: false })).toBe('none');
    expect(consumeSelfInspectionSeededEntry(seeded, { entryKey: 's:0', isSeedPending: false, isSavedOnServer: true })).toBe('rebind_to_server');
    expect(consumeSelfInspectionSeededEntry(seeded, { entryKey: 's:0', isSeedPending: false, isSavedOnServer: true })).toBe('none');
    expect(consumeSelfInspectionSeededEntry(seeded, { entryKey: 's:1', isSeedPending: false, isSavedOnServer: false })).toBe('none');
    expect(seeded.size).toBe(0);
  });

  it('does nothing for entries that were never seeded', () => {
    const seeded = new Set<string>();
    expect(consumeSelfInspectionSeededEntry(seeded, { entryKey: 's:2', isSeedPending: false, isSavedOnServer: true })).toBe('none');
  });
});
