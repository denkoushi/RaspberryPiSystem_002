import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  LEADER_BOARD_PERSIST_DEVICE_SCOPE_SCHEMA_VERSION,
  persistedLeaderBoardDeviceScopeStorageKey,
  type PersistedLeaderBoardActiveDeviceScope
} from './constants';

function loadStoredDevice(scopeStorageKey: string): string | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(scopeStorageKey);
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedLeaderBoardActiveDeviceScope> | null;
    if (!parsed || parsed.schemaVersion !== LEADER_BOARD_PERSIST_DEVICE_SCOPE_SCHEMA_VERSION) {
      return null;
    }
    const key = typeof parsed.deviceScopeKey === 'string' ? parsed.deviceScopeKey.trim() : '';
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

function persistDevice(scopeStorageKey: string, deviceScopeKey: string): void {
  if (typeof window === 'undefined') return;
  const payload: PersistedLeaderBoardActiveDeviceScope = {
    schemaVersion: LEADER_BOARD_PERSIST_DEVICE_SCOPE_SCHEMA_VERSION,
    deviceScopeKey: deviceScopeKey.trim()
  };
  window.localStorage.setItem(scopeStorageKey, JSON.stringify(payload));
}

/**
 * 順位ボードの対象端末（deviceScopeKey）を工場サイト単位で localStorage に保存する。
 */
export function usePersistedLeaderBoardDeviceScope(siteKey: string, validDeviceScopeKeys: readonly string[]) {
  const scopeStorageKey = useMemo(() => persistedLeaderBoardDeviceScopeStorageKey(siteKey), [siteKey]);
  const keySignature = useMemo(() => validDeviceScopeKeys.join('\0'), [validDeviceScopeKeys]);

  const [activeDeviceScopeKey, setInternal] = useState(() => {
    const stored =
      typeof window !== 'undefined' ? loadStoredDevice(persistedLeaderBoardDeviceScopeStorageKey(siteKey)) : null;
    const first = validDeviceScopeKeys[0];
    const candidate =
      stored && validDeviceScopeKeys.includes(stored) ? stored : first != null && first.length > 0 ? first : '';
    return candidate;
  });

  const resolveAgainstValidList = useCallback(
    (candidate: string | null): string => {
      if (candidate && validDeviceScopeKeys.includes(candidate)) {
        return candidate;
      }
      return validDeviceScopeKeys[0] ?? '';
    },
    [validDeviceScopeKeys]
  );

  /** クエリ済みで端末キー一覧が確定したら、保存済みとの整合を継続的に取る */
  useEffect(() => {
    const stored = loadStoredDevice(scopeStorageKey);
    const next = resolveAgainstValidList(stored);
    setInternal((prev) => (prev !== next ? next : prev));
  }, [resolveAgainstValidList, scopeStorageKey, keySignature]);

  const setActiveDeviceScopeKey = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      const safe = trimmed.length === 0 ? '' : resolveAgainstValidList(trimmed);
      setInternal(safe);
      if (safe.length > 0) {
        persistDevice(scopeStorageKey, safe);
      }
    },
    [resolveAgainstValidList, scopeStorageKey]
  );

  return { activeDeviceScopeKey, setActiveDeviceScopeKey };
}
