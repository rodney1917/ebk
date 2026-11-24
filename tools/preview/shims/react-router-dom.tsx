/**
 * PREVIEW-ONLY minimal stand-in for react-router-dom (hash-based), used solely by
 * tools/preview/build-preview.mjs when the real package cannot be installed.
 * The application itself depends on the real react-router-dom (see apps/web/package.json).
 */
import { Children, createContext, isValidElement, useCallback, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';

interface Loc { pathname: string; search: string; state: unknown }
const readLoc = (): Loc => {
  const h = window.location.hash.slice(1) || '/';
  const [pathname, search = ''] = h.split('?');
  return { pathname: pathname || '/', search: search ? `?${search}` : '', state: (window.history.state as { usr?: unknown } | null)?.usr };
};

const RouterCtx = createContext<{ loc: Loc; navigate: (to: string | number, o?: { replace?: boolean; state?: unknown }) => void } | null>(null);
const RouteCtx = createContext<{ params: Record<string, string>; outlet: ReactNode }>({ params: {}, outlet: null });

export function BrowserRouter({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(readLoc);
  useEffect(() => {
    const on = () => setLoc(readLoc());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const navigate = useCallback((to: string | number, o: { replace?: boolean; state?: unknown } = {}) => {
    if (typeof to === 'number') return window.history.go(to);
    const url = `${window.location.pathname}${window.location.search}#${to}`;
    if (o.replace) window.history.replaceState({ usr: o.state }, '', url);
    else window.history.pushState({ usr: o.state }, '', url);
    setLoc(readLoc());
    window.scrollTo(0, 0);
  }, []);
  return <RouterCtx.Provider value={{ loc, navigate }}>{children}</RouterCtx.Provider>;
}

function useRouter() {
  const r = useContext(RouterCtx);
  if (!r) throw new Error('Router missing');
  return r;
}

function match(pattern: string, pathname: string): Record<string, string> | null {
  if (pattern === '*') return {};
  const p = pattern.split('/').filter(Boolean);
  const s = pathname.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i]!.startsWith(':')) params[p[i]!.slice(1)] = decodeURIComponent(s[i]!);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

interface RouteProps { path?: string; element?: ReactNode; children?: ReactNode; index?: boolean }
export function Route(_: RouteProps): null { return null; }

function resolve(children: ReactNode, pathname: string): ReactNode | null {
  for (const child of Children.toArray(children)) {
    if (!isValidElement(child)) continue;
    const { path, element, children: nested } = (child as ReactElement<RouteProps>).props;
    if (path !== undefined) {
      const params = match(path, pathname);
      if (params) return <RouteCtx.Provider value={{ params, outlet: null }}>{element}</RouteCtx.Provider>;
    } else if (nested) {
      const inner = resolve(nested, pathname);
      if (inner) return <RouteCtx.Provider value={{ params: {}, outlet: inner }}>{element}</RouteCtx.Provider>;
    }
  }
  return null;
}

export function Routes({ children }: { children: ReactNode }) {
  const { loc } = useRouter();
  return <>{resolve(children, loc.pathname)}</>;
}

export function Outlet() {
  return <>{useContext(RouteCtx).outlet}</>;
}

export function Navigate({ to, replace, state }: { to: string; replace?: boolean; state?: unknown }) {
  const { navigate } = useRouter();
  useEffect(() => navigate(to, { replace, state }), [to]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; replace?: boolean };
export function Link({ to, replace, onClick, ...rest }: LinkProps) {
  const { navigate } = useRouter();
  return <a href={`#${to}`} onClick={(e) => { onClick?.(e); if (!e.defaultPrevented && !e.metaKey && !e.ctrlKey) { e.preventDefault(); navigate(to, { replace }); } }} {...rest} />;
}

export function NavLink({ to, end, className, children, ...rest }: Omit<LinkProps, 'className' | 'children'> & { end?: boolean; className?: string | ((s: { isActive: boolean }) => string); children?: ReactNode }) {
  const { loc } = useRouter();
  const isActive = end || to === '/' ? loc.pathname === to : loc.pathname === to || loc.pathname.startsWith(`${to}/`);
  return <Link to={to} aria-current={isActive ? 'page' : undefined} className={typeof className === 'function' ? className({ isActive }) : className} {...rest}>{children}</Link>;
}

export const useNavigate = () => useRouter().navigate;
export const useLocation = () => useRouter().loc;
export const useParams = <T extends Record<string, string>>() => useContext(RouteCtx).params as Partial<T>;
export function useSearchParams(): [URLSearchParams, (p: Record<string, string>, o?: { replace?: boolean }) => void] {
  const { loc, navigate } = useRouter();
  const params = useMemo(() => new URLSearchParams(loc.search), [loc.search]);
  const set = (p: Record<string, string>, o?: { replace?: boolean }) => {
    const qs = new URLSearchParams(p).toString();
    navigate(`${loc.pathname}${qs ? `?${qs}` : ''}`, o);
  };
  return [params, set];
}
