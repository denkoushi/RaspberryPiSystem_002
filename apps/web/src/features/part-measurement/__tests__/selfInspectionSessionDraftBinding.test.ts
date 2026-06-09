import { describe, expect, it } from 'vitest';

import {
  buildSelfInspectionDraftBoundKey,
  canRebindSelfInspectionEntryDraft,
  resolveSelfInspectionDraftBoundKeySyncWithoutRebind
} from '../selfInspectionSessionDraftBinding';

import type { SelfInspectionSessionDetailDto } from '../types';

function sessionFixture(
  focusedEntry: SelfInspectionSessionDetailDto['focusedEntry']
): SelfInspectionSessionDetailDto {
  return {
    id: 'session-1',
    focusedEntry,
    entries: [],
    template: {
      id: 'tpl-1',
      items: [{ id: 'item-1', sortOrder: 0 } as SelfInspectionSessionDetailDto['template']['items'][number]]
    }
  } as SelfInspectionSessionDetailDto;
}

describe('selfInspectionSessionDraftBinding', () => {
  it('builds empty draft bound key for unsaved entry', () => {
    const session = sessionFixture(null);
    expect(buildSelfInspectionDraftBoundKey(session, 2)).toBe('session-1:2:empty');
  });

  it('builds draft bound key from focused entry updatedAt', () => {
    const session = sessionFixture({
      entryIndex: 2,
      updatedAt: '2026-06-09T10:00:00.000Z'
    } as SelfInspectionSessionDetailDto['focusedEntry']);
    expect(buildSelfInspectionDraftBoundKey(session, 2)).toBe('session-1:2:2026-06-09T10:00:00.000Z');
  });

  it('blocks rebind while placeholder data is shown', () => {
    const session = sessionFixture({
      entryIndex: 1,
      updatedAt: '2026-06-09T10:00:00.000Z',
      values: []
    } as SelfInspectionSessionDetailDto['focusedEntry']);
    expect(
      canRebindSelfInspectionEntryDraft({
        session,
        entryIndex: 1,
        isPlaceholderData: true,
        draftValuesByEntryIndex: {},
        savedDraftByEntryIndex: {}
      })
    ).toBe(false);
  });

  it('allows rebind for unsaved entry when focusedEntry is null', () => {
    const session = sessionFixture(null);
    expect(
      canRebindSelfInspectionEntryDraft({
        session,
        entryIndex: 1,
        isPlaceholderData: false,
        draftValuesByEntryIndex: {},
        savedDraftByEntryIndex: {}
      })
    ).toBe(true);
  });

  it('allows rebind for saved entry using entries list when focus is elsewhere', () => {
    const session = {
      ...sessionFixture({
        entryIndex: 0,
        updatedAt: '2026-06-09T10:00:00.000Z',
        values: []
      } as SelfInspectionSessionDetailDto['focusedEntry']),
      entries: [
        {
          entryIndex: 1,
          updatedAt: '2026-06-09T11:00:00.000Z',
          values: [{ templateItemId: 'item-1', value: '5' }]
        } as SelfInspectionSessionDetailDto['entries'][number]
      ]
    };
    expect(
      canRebindSelfInspectionEntryDraft({
        session,
        entryIndex: 1,
        isPlaceholderData: false,
        draftValuesByEntryIndex: {},
        savedDraftByEntryIndex: {}
      })
    ).toBe(true);
  });

  it('syncs bound key without rebind when dirty draft is preserved', () => {
    const session = sessionFixture({
      entryIndex: 1,
      updatedAt: '2026-06-09T10:00:00.000Z',
      values: [{ templateItemId: 'item-1', value: '10' }]
    } as SelfInspectionSessionDetailDto['focusedEntry']);
    expect(
      resolveSelfInspectionDraftBoundKeySyncWithoutRebind({
        session,
        entryIndex: 1,
        isPlaceholderData: false,
        draftBoundKey: 'session-1:0:empty',
        draftValuesByEntryIndex: { 1: { 'item-1': '11' } },
        savedDraftByEntryIndex: { 1: { 'item-1': '10' } }
      })
    ).toBe('session-1:1:2026-06-09T10:00:00.000Z');
  });

  it('does not sync bound key while placeholder data is shown', () => {
    const session = sessionFixture({
      entryIndex: 1,
      updatedAt: '2026-06-09T10:00:00.000Z',
      values: []
    } as SelfInspectionSessionDetailDto['focusedEntry']);
    expect(
      resolveSelfInspectionDraftBoundKeySyncWithoutRebind({
        session,
        entryIndex: 1,
        isPlaceholderData: true,
        draftBoundKey: 'session-1:0:empty',
        draftValuesByEntryIndex: { 1: { 'item-1': '11' } },
        savedDraftByEntryIndex: { 1: { 'item-1': '10' } }
      })
    ).toBeNull();
  });

  it('blocks rebind when current draft is dirty', () => {
    const session = sessionFixture({
      entryIndex: 1,
      updatedAt: '2026-06-09T10:00:00.000Z',
      values: [{ templateItemId: 'item-1', value: '10' }]
    } as SelfInspectionSessionDetailDto['focusedEntry']);
    expect(
      canRebindSelfInspectionEntryDraft({
        session,
        entryIndex: 1,
        isPlaceholderData: false,
        draftValuesByEntryIndex: { 1: { 'item-1': '11' } },
        savedDraftByEntryIndex: { 1: { 'item-1': '10' } }
      })
    ).toBe(false);
  });
});
