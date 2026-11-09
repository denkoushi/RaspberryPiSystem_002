import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { loginRequest, logoutRequest, setAuthToken } from '../api/client';
import { registerAuthRefresh, withAuthRefreshLock } from '../api/http';

import type { AuthResponse } from '../api/types';
import type { PropsWithChildren } from 'react';

interface AuthState {
  user: AuthResponse['user'] | null;
  token: string | null;
  loading: boolean;
  login: (
    username: string,
    password: string,
    opts?: { totpCode?: string; backupCode?: string; rememberMe?: boolean }
  ) => Promise<void>;
  logout: () => Promise<void>;
  updateSession: (response: AuthResponse) => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

const STORAGE_KEY = 'factory-auth';
const REMEMBER_DAYS = 7;

interface StoredSession {
  loginId: string;
  token: string;
  refresh: string;
  user: AuthResponse['user'];
  expiresAt?: string;
}

function newLoginId() {
  return globalThis.crypto?.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readStoredSession(includeExpired = false): StoredSession | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as StoredSession;
    if (!includeExpired && parsed.expiresAt && new Date(parsed.expiresAt).getTime() <= Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const session = useRef<StoredSession | null | undefined>(undefined);
  if (session.current === undefined) {
    session.current = readStoredSession();
    if (session.current && !session.current.loginId) session.current.loginId = newLoginId();
    setAuthToken(session.current?.token);
  }
  const remembered = useRef(Boolean(session.current));
  const [token, setToken] = useState<string | null>(session.current?.token ?? null);
  const [user, setUser] = useState<AuthResponse['user'] | null>(session.current?.user ?? null);
  const [loading, setLoading] = useState(false);

  const clearSession = useCallback(() => {
    session.current = null;
    remembered.current = false;
    setToken(null);
    setUser(null);
    setAuthToken(undefined);
  }, []);

  const login = useCallback(async (username: string, password: string, opts?: { totpCode?: string; backupCode?: string; rememberMe?: boolean }) => {
    setLoading(true);
    try {
      const response = await loginRequest({
        username,
        password,
        totpCode: opts?.totpCode,
        backupCode: opts?.backupCode,
        rememberMe: opts?.rememberMe
      });
      const current: StoredSession = {
        loginId: newLoginId(), token: response.accessToken, refresh: response.refreshToken, user: response.user,
        expiresAt: new Date(Date.now() + REMEMBER_DAYS * 24 * 60 * 60 * 1000).toISOString()
      };
      session.current = current;
      // Until persistence finishes, storage events still describe the previous login.
      remembered.current = false;
      setToken(current.token);
      setUser(current.user);
      setAuthToken(current.token);
      await withAuthRefreshLock(() => {
        if (session.current?.loginId !== current.loginId) return;
        remembered.current = Boolean(opts?.rememberMe);
        if (remembered.current) localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
        else localStorage.removeItem(STORAGE_KEY);
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const applySession = useCallback((response: AuthResponse) => {
    const current = session.current;
    if (!current) return;
    session.current = { ...current, token: response.accessToken, refresh: response.refreshToken, user: response.user };
    setToken(response.accessToken);
    setUser(response.user);
    setAuthToken(response.accessToken);
    if (remembered.current) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session.current));
    }
  }, []);

  const updateSession = useCallback((response: AuthResponse) => {
    const loginId = session.current?.loginId;
    void withAuthRefreshLock(() => {
      if (!loginId || session.current?.loginId !== loginId) return;
      if (remembered.current && readStoredSession()?.loginId !== loginId) {
        clearSession();
        return;
      }
      applySession(response);
    });
  }, [applySession, clearSession]);

  useEffect(() => {
    // Upgrade old remembered sessions under the same lock as every other writer.
    void withAuthRefreshLock(() => {
      const stored = readStoredSession();
      if (remembered.current && session.current && stored && !stored.loginId) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stored, loginId: session.current.loginId }));
      } else if (!stored && localStorage.getItem(STORAGE_KEY)) {
        localStorage.removeItem(STORAGE_KEY);
      }
    });
    const syncStoredSession = () => {
      if (!remembered.current || !session.current) return;
      const stored = readStoredSession();
      if (!stored || stored.loginId !== session.current.loginId) {
        clearSession();
        return;
      }
      session.current = stored;
      setToken(stored.token);
      setUser(stored.user);
      setAuthToken(stored.token);
    };
    const unregister = registerAuthRefresh({
      getSession: () => session.current ? {
        accessToken: session.current.token, refreshToken: session.current.refresh, loginId: session.current.loginId
      } : null,
      prepareSession: () => {
        if (remembered.current) {
          const stored = readStoredSession(true);
          if (stored?.loginId === session.current?.loginId && stored?.expiresAt && new Date(stored.expiresAt).getTime() <= Date.now()) {
            localStorage.removeItem(STORAGE_KEY);
          }
        }
        syncStoredSession();
        const current = session.current;
        if (current && (!current.refresh || (current.expiresAt && new Date(current.expiresAt).getTime() <= Date.now()))) {
          if (remembered.current) localStorage.removeItem(STORAGE_KEY);
          clearSession();
        }
      },
      onSuccess: applySession,
      onFailure: () => {
        if (remembered.current) localStorage.removeItem(STORAGE_KEY);
        clearSession();
      }
    });
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea === localStorage && (event.key === STORAGE_KEY || event.key === null)) syncStoredSession();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      unregister();
      window.removeEventListener('storage', onStorage);
    };
  }, [applySession, clearSession]);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } catch {
      // Local logout must also work while the API is unavailable.
    } finally {
      const loginId = session.current?.loginId;
      const removeStored = remembered.current;
      clearSession();
      await withAuthRefreshLock(() => {
        if (removeStored && readStoredSession(true)?.loginId === loginId) localStorage.removeItem(STORAGE_KEY);
      });
    }
  }, [clearSession]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      token,
      loading,
      login,
      logout,
      updateSession
    }),
    [loading, login, logout, token, user, updateSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
