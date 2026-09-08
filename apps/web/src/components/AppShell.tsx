import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  Bell,
  CalendarDays,
  Library,
  ListChecks,
  Search,
  Settings,
  ShieldCheck,
  UserRound,
  WifiOff,
} from 'lucide-react';
import { api } from '../lib/api';
import { QUEUED_EVENT, flushProgressQueue, pendingCount } from '../lib/offline';
import { useSession } from '../hooks/useSession';
import { SearchPanel } from './SearchPanel';
import { IconButton, Modal, cn } from './ui';
import type { TranslationKey } from '../lib/i18n';

interface NavItem {
  to: string;
  icon: typeof Library;
  key: TranslationKey;
  end?: boolean;
}

/**
 * La navigation est répartie en deux familles plutôt qu'en une liste plate :
 * d'un côté ce qu'on consulte, de l'autre ce qu'on règle. En liste plate,
 * « Réglages » avait le même poids visuel que « Bibliothèque ».
 */
const suivi: NavItem[] = [
  { to: '/', icon: Library, key: 'nav.library', end: true },
  { to: '/queue', icon: ListChecks, key: 'nav.queue' },
  { to: '/calendar', icon: CalendarDays, key: 'nav.calendar' },
  { to: '/stats', icon: BarChart3, key: 'nav.stats' },
];

const compte: NavItem[] = [
  { to: '/profile', icon: UserRound, key: 'nav.profile' },
  { to: '/settings', icon: Settings, key: 'nav.settings' },
];

/** Barre du bas sur téléphone : cinq cibles maximum, sinon plus rien n'est atteignable. */
const mobileItems: NavItem[] = [...suivi, { to: '/profile', icon: UserRound, key: 'nav.profile' }];

/**
 * Coquille de l'application : barre latérale sur ordinateur, barre inférieure
 * sur téléphone. La recherche est accessible partout — ⌘K au clavier, bouton
 * dédié au doigt.
 */
export function AppShell() {
  const { t, user } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchOpen, setSearchOpen] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [pending, setPending] = useState(0);

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.notifications(),
    refetchInterval: 5 * 60_000,
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Retour du réseau : on rejoue les marquages faits hors connexion avant de
  // rafraîchir les écrans, sinon l'utilisateur verrait sa progression reculer.
  useEffect(() => {
    const sync = async () => {
      setOffline(!navigator.onLine);
      if (!navigator.onLine) return;
      const flushed = await flushProgressQueue();
      setPending(await pendingCount());
      if (flushed > 0) await queryClient.invalidateQueries();
    };

    const refreshPending = async () => setPending(await pendingCount());

    void sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    window.addEventListener(QUEUED_EVENT, refreshPending);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      window.removeEventListener(QUEUED_EVENT, refreshPending);
    };
  }, [queryClient]);

  const unread = notifications.data?.unread ?? 0;
  const isAdmin = user?.role === 'admin';

  return (
    <div className="flex min-h-full">
      {/* Barre latérale — ordinateur */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-[var(--border)] px-3 py-5 md:flex">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <Logo />
          <span className="text-xl font-semibold tracking-tight">ScanLib</span>
        </div>

        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="mb-5 flex min-h-11 items-center gap-2.5 rounded-xl border border-[var(--border)] px-3 text-[0.9375rem] text-[var(--text-muted)] transition-colors hover:border-[var(--color-ink-600)]"
        >
          <Search size={18} />
          <span className="flex-1 text-left">{t('common.search')}</span>
          <kbd className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[0.6875rem]">
            ⌘K
          </kbd>
        </button>

        <nav className="flex flex-1 flex-col gap-6">
          <NavGroup label={t('nav.groupTracking')} items={suivi} t={t} />

          <div className="flex flex-col gap-1">
            <GroupLabel>{t('nav.groupAccount')}</GroupLabel>
            {compte.map((item) => (
              <SidebarLink key={item.to} item={item} t={t} />
            ))}

            {/* Invisible pour les comptes standards. */}
            {isAdmin ? (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  cn(
                    'mt-1 flex min-h-11 items-center gap-3 rounded-xl border px-3 text-[0.9375rem] font-medium transition-colors',
                    isActive
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--text)]'
                      : 'border-[var(--color-accent)]/35 text-[var(--color-accent-soft)] hover:bg-[var(--color-accent)]/10',
                  )
                }
              >
                <ShieldCheck size={19} />
                {t('nav.admin')}
              </NavLink>
            ) : null}
          </div>
        </nav>

        <div className="mt-6 border-t border-[var(--border)] pt-3">
          <NotificationBell unread={unread} onOpen={() => navigate('/queue')} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barre supérieure — téléphone */}
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)]/90 px-3 py-2 backdrop-blur md:hidden">
          <Logo />
          <span className="flex-1 text-lg font-semibold">ScanLib</span>
          {isAdmin ? (
            <IconButton label={t('nav.admin')} onClick={() => navigate('/admin')}>
              <ShieldCheck size={20} className="text-[var(--color-accent-soft)]" />
            </IconButton>
          ) : null}
          <IconButton label={t('common.search')} onClick={() => setSearchOpen(true)}>
            <Search size={20} />
          </IconButton>
          <NotificationBell unread={unread} onOpen={() => navigate('/queue')} compact />
        </header>

        {offline || pending > 0 ? (
          <div className="flex items-center gap-2 bg-[var(--color-warning)]/15 px-4 py-2 text-xs text-[var(--color-warning)]">
            <WifiOff size={14} />
            {offline
              ? 'Hors ligne — vos actions seront synchronisées au retour du réseau.'
              : `${pending} action(s) en attente de synchronisation.`}
          </div>
        ) : null}

        {/* La largeur suit l'écran plutôt que de rester bloquée à 1152 px :
            sur un grand moniteur, une colonne étroite gâche la place et réduit
            le nombre de jaquettes visibles d'un coup d'œil. */}
        <main className="w-full flex-1 px-4 pt-5 pb-24 md:px-8 md:pb-10 2xl:px-12">
          <Outlet />
        </main>

        {/* Barre inférieure — téléphone */}
        <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--border)] bg-[var(--surface)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          {mobileItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.6875rem] font-medium',
                  isActive ? 'text-[var(--color-accent-soft)]' : 'text-[var(--text-muted)]',
                )
              }
            >
              <item.icon size={22} />
              {t(item.key)}
            </NavLink>
          ))}
        </nav>
      </div>

      <Modal open={searchOpen} onClose={() => setSearchOpen(false)} title="Rechercher" wide>
        <div className="max-h-[70vh] overflow-y-auto p-4">
          <SearchPanel autoFocus onNavigate={() => setSearchOpen(false)} />
        </div>
      </Modal>
    </div>
  );
}

function NavGroup({
  label,
  items,
  t,
}: {
  label: string;
  items: NavItem[];
  t: (key: TranslationKey) => string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <GroupLabel>{label}</GroupLabel>
      {items.map((item) => (
        <SidebarLink key={item.to} item={item} t={t} />
      ))}
    </div>
  );
}

function GroupLabel({ children }: { children: string }) {
  return (
    <p className="mb-1 px-3 text-[0.6875rem] font-semibold tracking-wider text-[var(--text-muted)] uppercase">
      {children}
    </p>
  );
}

function SidebarLink({ item, t }: { item: NavItem; t: (key: TranslationKey) => string }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'flex min-h-11 items-center gap-3 rounded-xl px-3 text-[0.9375rem] font-medium transition-colors',
          isActive
            ? 'bg-[var(--surface-hover)] text-[var(--text)]'
            : 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]',
        )
      }
    >
      <item.icon size={19} />
      {t(item.key)}
    </NavLink>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 64 64" className="size-8" aria-hidden>
      <rect width="64" height="64" rx="14" fill="var(--color-ink-800)" />
      <rect x="14" y="14" width="10" height="36" rx="2" fill="var(--color-accent)" />
      <rect x="27" y="14" width="10" height="36" rx="2" fill="var(--color-anime)" />
      <rect x="40" y="14" width="10" height="36" rx="2" fill="var(--color-manga)" />
    </svg>
  );
}

function NotificationBell({
  unread,
  onOpen,
  compact,
}: {
  unread: number;
  onOpen: () => void;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();

  const handle = async () => {
    if (unread > 0) {
      await api.markNotificationsRead().catch(() => undefined);
      await queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }
    onOpen();
  };

  return (
    <div className={compact ? '' : 'px-1'}>
      <IconButton label="Notifications" onClick={handle} className="relative">
        <Bell size={20} />
        {unread > 0 ? (
          <span className="absolute top-2 right-2 flex size-4 items-center justify-center rounded-full bg-[var(--color-danger)] text-[9px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </IconButton>
    </div>
  );
}
