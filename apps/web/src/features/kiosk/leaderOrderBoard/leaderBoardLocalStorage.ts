export function readLeaderBoardLocalStorage(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLeaderBoardLocalStorage(key: string, value: string | null): boolean {
  try {
    if (typeof window === 'undefined') return false;
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    return true;
  } catch {
    // Keep using the in-memory settings when storage is unavailable.
    return false;
  }
}
