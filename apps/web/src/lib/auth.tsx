import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createApi, HttpTransport, type Api, type Transport } from './api';
import { DemoTransport } from './demo-transport';
import type { Me } from './types';

declare const __EBK_DEMO__: boolean;
export const IS_DEMO = typeof __EBK_DEMO__ !== 'undefined' && __EBK_DEMO__;

const http = new HttpTransport(import.meta.env.VITE_API_BASE_URL ?? '/api');
const transport: Transport = IS_DEMO ? new DemoTransport() : http;
export const api: Api = createApi(transport);

interface AuthState {
  status: 'loading' | 'signed-in' | 'signed-out';
  me: Me | null;
  login: (email: string, password: string) => Promise<void>;
  register: (input: Parameters<Api['auth']['register']>[0]) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');

  const loadMe = useCallback(async () => {
    try {
      setMe(await api.auth.me());
      setStatus('signed-in');
    } catch {
      setMe(null);
      setStatus('signed-out');
    }
  }, []);

  useEffect(() => {
    (async () => {
      if (!IS_DEMO) await http.refresh(); // restore session from the httpOnly refresh cookie
      await loadMe();
    })();
    if (IS_DEMO) return;
    const off = http.onToken((t) => {
      if (!t) {
        setMe(null);
        setStatus('signed-out');
      }
    });
    return () => {
      off();
    };
  }, [loadMe]);

  const value = useMemo<AuthState>(() => ({
    status,
    me,
    reload: loadMe,
    login: async (email, password) => {
      const t = await api.auth.login(email, password);
      if (!IS_DEMO) http.setToken(t.accessToken);
      await loadMe();
    },
    register: async (input) => {
      const t = await api.auth.register(input);
      if (!IS_DEMO) http.setToken(t.accessToken);
      await loadMe();
    },
    logout: async () => {
      await api.auth.logout().catch(() => undefined);
      if (!IS_DEMO) http.setToken(null);
      qc.clear();
      setMe(null);
      setStatus('signed-out');
    },
  }), [status, me, loadMe, qc]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
