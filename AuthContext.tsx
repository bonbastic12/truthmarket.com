import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, tokenStore } from '../api';
import type { PublicUser } from '../types';

interface AuthState {
  user: PublicUser | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(input: { name: string; email: string; phone: string; password: string }): Promise<void>;
  logout(): void;
  /** Reloads the signed-in user, for example after the identity check changes. */
  refresh(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState<boolean>(() => tokenStore.get() !== null);

  useEffect(() => {
    if (!tokenStore.get()) return;
    api<{ user: PublicUser }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ token: string; user: PublicUser }>('/auth/login', { method: 'POST', body: { email, password } });
    tokenStore.set(r.token);
    setUser(r.user);
  }, []);

  const register = useCallback(async (input: { name: string; email: string; phone: string; password: string }) => {
    const r = await api<{ token: string; user: PublicUser }>('/auth/register', { method: 'POST', body: input });
    tokenStore.set(r.token);
    setUser(r.user);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setUser((await api<{ user: PublicUser }>('/auth/me')).user);
    } catch {
      /* keep the current user; the next request will show the real problem */
    }
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, register, logout, refresh }), [user, loading, login, register, logout, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
