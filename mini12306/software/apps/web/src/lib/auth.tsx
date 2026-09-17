import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, tokenStore } from './api';

export interface AuthUser {
  id: number;
  username: string;
  realName: string;
  phone: string;
  role: 'PASSENGER' | 'CLERK' | 'ADMIN';
  status: string;
  isVerified: boolean;
  bankCardLast4?: string | null;
  idCardMasked?: string;
  lastLoginAt?: string | null;
  createdAt?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => void;
  refresh: () => Promise<void>;
  isStaff: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api.get<AuthUser>('/auth/me');
      setUser(me);
    } catch {
      tokenStore.clear();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const data = await api.post<{ token: string; user: AuthUser }>('/auth/login', { username, password });
    tokenStore.set(data.token);
    const me = await api.get<AuthUser>('/auth/me');
    setUser(me ?? data.user);
    return me ?? data.user;
  }, []);

  const logout = useCallback(() => {
    void api.post('/auth/logout').catch(() => undefined);
    tokenStore.clear();
    setUser(null);
  }, []);

  const value: AuthContextValue = {
    user,
    loading,
    login,
    logout,
    refresh,
    isStaff: user?.role === 'CLERK' || user?.role === 'ADMIN',
    isAdmin: user?.role === 'ADMIN',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
