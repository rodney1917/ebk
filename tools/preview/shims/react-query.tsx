/**
 * PREVIEW-ONLY minimal stand-in for @tanstack/react-query (subset used by EBK web).
 * The application depends on the real package; this exists only for offline previews.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

type Key = readonly unknown[];
interface Entry { data?: unknown; error?: unknown; status: 'pending' | 'success' | 'error'; fetching: boolean; stale: boolean; fn?: () => Promise<unknown>; listeners: Set<() => void>; version: number }

export class QueryClient {
  cache = new Map<string, Entry>();
  constructor(_opts?: unknown) {}
  entry(key: Key): Entry {
    const k = JSON.stringify(key);
    let e = this.cache.get(k);
    if (!e) { e = { status: 'pending', fetching: false, stale: true, listeners: new Set(), version: 0 }; this.cache.set(k, e); }
    return e;
  }
  emit(e: Entry) { e.version++; e.listeners.forEach((l) => l()); }
  async fetch(key: Key, fn: () => Promise<unknown>) {
    const e = this.entry(key);
    e.fn = fn;
    if (e.fetching) return;
    e.fetching = true; this.emit(e);
    try { e.data = await fn(); e.error = undefined; e.status = 'success'; e.stale = false; }
    catch (err) { e.error = err; e.status = 'error'; }
    finally { e.fetching = false; this.emit(e); }
  }
  async invalidateQueries({ queryKey }: { queryKey: Key }) {
    const prefix = JSON.stringify(queryKey).slice(0, -1);
    for (const [k, e] of this.cache) if (k.startsWith(prefix)) { e.stale = true; if (e.fn && e.listeners.size) await this.fetch(JSON.parse(k), e.fn); }
  }
  clear() { this.cache.clear(); }
}

const Ctx = createContext<QueryClient | null>(null);
export const QueryClientProvider = ({ client, children }: { client: QueryClient; children: ReactNode }) => <Ctx.Provider value={client}>{children}</Ctx.Provider>;
export const useQueryClient = () => useContext(Ctx)!;

export function useQuery<T>({ queryKey, queryFn, enabled = true, refetchInterval }: { queryKey: Key; queryFn: () => Promise<T>; enabled?: boolean; retry?: unknown; refetchInterval?: number | false | ((q: { state: { data?: T } }) => number | false) }) {
  const qc = useQueryClient();
  const e = qc.entry(queryKey);
  const k = JSON.stringify(queryKey);
  useSyncExternalStore((cb) => { e.listeners.add(cb); return () => e.listeners.delete(cb); }, () => e.version);
  const fnRef = useRef(queryFn);
  fnRef.current = queryFn;
  useEffect(() => { if (enabled && (e.stale || e.status === 'pending')) qc.fetch(queryKey, () => fnRef.current()); }, [k, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  const interval = typeof refetchInterval === 'function' ? refetchInterval({ state: { data: e.data as T } }) : refetchInterval;
  useEffect(() => {
    if (!enabled || !interval) return;
    const id = setInterval(() => qc.fetch(queryKey, () => fnRef.current()), interval);
    return () => clearInterval(id);
  }, [k, enabled, interval]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    data: e.data as T | undefined,
    error: e.status === 'error' ? (e.error as Error) : null,
    isLoading: enabled && e.status === 'pending',
    isFetching: e.fetching,
    refetch: () => qc.fetch(queryKey, () => fnRef.current()),
  };
}

export function useMutation<T, V = void>({ mutationFn, onSuccess }: { mutationFn: (v: V) => Promise<T>; onSuccess?: (d: T) => void }) {
  const [state, setState] = useState<{ isPending: boolean; error: unknown; data?: T }>({ isPending: false, error: null });
  const mutateAsync = useCallback(async (v: V) => {
    setState({ isPending: true, error: null });
    try { const d = await mutationFn(v); setState({ isPending: false, error: null, data: d }); onSuccess?.(d); return d; }
    catch (err) { setState({ isPending: false, error: err }); throw err; }
  }, [mutationFn, onSuccess]);
  return { ...state, mutateAsync, mutate: (v: V) => { mutateAsync(v).catch(() => undefined); } };
}
