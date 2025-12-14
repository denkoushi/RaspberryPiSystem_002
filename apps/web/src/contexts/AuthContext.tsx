import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { loginRequest, setAuthToken } from '../api/client';

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
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

const STORAGE_KEY = 'factory-auth';
const REMEMBER_DAYS = 30;

export function AuthProvider({ children }: PropsWithChildren) {
  const [token, setToken] = useState<string | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    try {
      const parsed = JSON.parse(stored) as { token: string; user: AuthResponse['user']; expiresAt?: string };
      if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() < Date.now()) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      setAuthToken(parsed.token);
      return parsed.token;
    } catch {
      return null;
    }
  });

  const [user, setUser] = useState<AuthResponse['user'] | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    try {
      const parsed = JSON.parse(stored) as { user: AuthResponse['user']; expiresAt?: string };
      if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() < Date.now()) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return parsed.user;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (token) {
      setAuthToken(token);
    }
  }, [token]);

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
      setToken(response.accessToken);
      setUser(response.user);
      if (opts?.rememberMe) {
        const expiresAt = new Date(Date.now() + REMEMBER_DAYS * 24 * 60 * 60 * 1000).toISOString();
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ token: response.accessToken, user: response.user, refresh: response.refreshToken, expiresAt })
        );
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
      setAuthToken(response.accessToken);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
    setAuthToken(undefined);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      token,
      loading,
      login,
      logout
    }),
    [loading, login, logout, token, user]
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
