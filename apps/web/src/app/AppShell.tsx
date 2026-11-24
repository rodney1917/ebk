import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  cx, IconBell, IconHelp, IconHome, IconList, IconLogout, IconPhone, IconSend, IconUsers, Logo,
} from '../design-system';
import { IS_DEMO, useAuth } from '../lib/auth';
import { initials } from '../lib/format';

const NAV = [
  { to: '/', label: 'Home', icon: IconHome, end: true },
  { to: '/send', label: 'Send', icon: IconSend },
  { to: '/recipients', label: 'Recipients', icon: IconUsers },
  { to: '/transfers', label: 'Activity', icon: IconList },
  { to: '/airtime', label: 'Airtime', icon: IconPhone },
];

export function AppShell() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const name = me?.profile ? `${me.profile.firstName} ${me.profile.lastName}` : me?.email ?? '';

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[264px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:bg-white focus:px-4 focus:py-2 focus:rounded-lg">Skip to content</a>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col bg-navy-900 text-white sticky top-0 h-dvh px-5 py-6 ebk-grid-bg">
        <Logo inverted showTagline className="px-2" />
        <nav aria-label="Main" className="mt-10 flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => cx(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors',
                isActive ? 'bg-white/10 text-white shadow-[inset_3px_0_0_var(--color-emerald-500)]' : 'text-mint-300/80 hover:bg-white/5 hover:text-white',
              )}
            >
              <Icon /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-1">
          <NavLink to="/help" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] text-mint-300/80 hover:bg-white/5 hover:text-white"><IconHelp /> Help & support</NavLink>
          <button onClick={async () => { await logout(); navigate('/login'); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] text-mint-300/80 hover:bg-white/5 hover:text-white"><IconLogout /> Sign out</button>
          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-white/5 p-3">
            <span className="grid size-10 place-items-center rounded-full bg-emerald-600 text-sm font-bold">{initials(name)}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{name}</span>
              <span className="block truncate text-xs text-mint-300/70">{me?.email}</span>
            </span>
          </div>
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col">
        {IS_DEMO && (
          <div className="bg-warning-50 text-warning-700 text-center text-xs font-semibold py-1.5 px-4 border-b border-warning-700/15 no-print">
            DEMO PREVIEW — sample data and sandbox rates. No real money can be sent from this preview.
          </div>
        )}
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-20 flex items-center justify-between bg-white/90 backdrop-blur border-b border-line px-4 h-16 no-print">
          <Logo />
          <div className="flex items-center gap-1">
            <NavLink to="/help" className="rounded-full p-2.5 text-ink hover:bg-canvas" aria-label="Help"><IconHelp /></NavLink>
            <button className="rounded-full p-2.5 text-ink hover:bg-canvas" aria-label="Notifications"><IconBell /></button>
          </div>
        </header>

        <main id="main" className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 pt-6 lg:pt-10 pb-28 lg:pb-12">
          <Outlet />
        </main>

        {/* Mobile bottom navigation */}
        <nav aria-label="Main" className="lg:hidden fixed bottom-0 inset-x-0 z-20 bg-white border-t border-line pb-[env(safe-area-inset-bottom)] no-print">
          <ul className="grid grid-cols-5">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink to={to} end={end} className={({ isActive }) => cx('flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold', isActive ? 'text-emerald-700' : 'text-muted-strong')}>
                  {to === '/send' ? (
                    <span className="grid size-10 -mt-5 place-items-center rounded-full bg-emerald-600 text-white shadow-lg ring-4 ring-white"><Icon /></span>
                  ) : (
                    <Icon size={22} />
                  )}
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}
