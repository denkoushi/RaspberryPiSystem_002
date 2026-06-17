import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  LEADER_BOARD_DEFAULT_SLOT_COUNT,
  LEADER_BOARD_SLOT_SCHEMA_VERSION,
  leaderBoardSlotStorageKey
} from '../constants';
import {
  sanitizeLeaderBoardSlotResourceCd,
  uniqueOrderedResourceCds,
  useLeaderBoardResourceSlots
} from '../useLeaderBoardResourceSlots';

const EMPTY_FALLBACK: string[] = [];
const FALLBACK_WITH_TEN: string[] = ['10', '305'];

describe('sanitizeLeaderBoardSlotResourceCd', () => {
  it('nulls FSIGENCD=10', () => {
    expect(sanitizeLeaderBoardSlotResourceCd('10')).toBeNull();
    expect(sanitizeLeaderBoardSlotResourceCd(' 10 ')).toBeNull();
  });

  it('keeps normal resource CDs', () => {
    expect(sanitizeLeaderBoardSlotResourceCd('021')).toBe('021');
  });
});

describe('uniqueOrderedResourceCds', () => {
  it('keeps slot order and skips nulls', () => {
    expect(uniqueOrderedResourceCds(['305', null, '401'])).toEqual(['305', '401']);
  });

  it('dedupes later duplicates', () => {
    expect(uniqueOrderedResourceCds(['305', '401', '305'])).toEqual(['305', '401']);
  });

  it('trims and drops empty', () => {
    expect(uniqueOrderedResourceCds(['  ', '  99  ', null])).toEqual(['99']);
  });

  it('excludes FSIGENCD=10', () => {
    expect(uniqueOrderedResourceCds(['10', '021', '10'])).toEqual(['021']);
  });
});

describe('useLeaderBoardResourceSlots hydration', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('strips FSIGENCD=10 from persisted slots on load', async () => {
    const key = leaderBoardSlotStorageKey('scope-a');
    window.localStorage.setItem(
      key,
      JSON.stringify({
        schemaVersion: LEADER_BOARD_SLOT_SCHEMA_VERSION,
        slotCount: LEADER_BOARD_DEFAULT_SLOT_COUNT,
        resourceCdBySlotIndex: ['10', '021', null]
      })
    );

    const { result } = renderHook(() =>
      useLeaderBoardResourceSlots({
        scopeKey: 'scope-a',
        fallbackAssignedResourceCds: EMPTY_FALLBACK
      })
    );

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
    });

    expect(result.current.resourceCdBySlotIndex[0]).toBeNull();
    expect(result.current.resourceCdBySlotIndex[1]).toBe('021');
    expect(result.current.activeResourceCds).toEqual(['021']);
  });

  it('strips FSIGENCD=10 from fallback seed when no persistence', async () => {
    const { result } = renderHook(() =>
      useLeaderBoardResourceSlots({
        scopeKey: 'scope-b',
        fallbackAssignedResourceCds: FALLBACK_WITH_TEN
      })
    );

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
    });

    expect(result.current.resourceCdBySlotIndex[0]).toBe('305');
    expect(result.current.activeResourceCds).toEqual(['305']);
  });

  it('does not rehydrate repeatedly when fallback array identity changes', async () => {
    const { result, rerender } = renderHook(() =>
      useLeaderBoardResourceSlots({
        scopeKey: 'scope-c',
        fallbackAssignedResourceCds: ['10', '305']
      })
    );

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
    });

    rerender();

    expect(result.current.resourceCdBySlotIndex[0]).toBe('305');
    expect(result.current.activeResourceCds).toEqual(['305']);
  });
});
