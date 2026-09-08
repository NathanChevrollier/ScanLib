import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from './components/AppShell';
import { LoadingBlock } from './components/ui';
import { SessionProvider, useSession } from './hooks/useSession';
import { ToastsProvider, useToasts } from './hooks/useToasts';
import { AdminPage } from './routes/Admin';
import { CalendarPage } from './routes/Calendar';
import { LibraryPage } from './routes/Library';
import { LoginPage } from './routes/Login';
import { ProfilePage } from './routes/Profile';
import { QueuePage } from './routes/Queue';
import { SearchPage } from './routes/Search';
import { SettingsPage } from './routes/Settings';
import { StatsPage } from './routes/Stats';
import { WorkPage } from './routes/Work';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Les données viennent d'API externes limitées en débit : on évite les
      // rechargements réflexes au moindre changement de fenêtre.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
  /*
   * Filet commun à toutes les mutations : une action qui échoue le dit, même si
   * l'écran concerné n'a pas prévu de gestion d'erreur. Les écrans qui affichent
   * déjà l'erreur autrement restent libres de définir leur propre `onError`.
   */
  mutationCache: new MutationCache({
    onError: (error) => {
      window.dispatchEvent(
        new CustomEvent(MUTATION_ERROR_EVENT, {
          detail: error instanceof Error ? error.message : 'Action impossible pour le moment.',
        }),
      );
    },
  }),
});

/** Nom de l'événement par lequel une mutation en échec remonte aux messages. */
export const MUTATION_ERROR_EVENT = 'scanlib:mutation-error';

/** Relaie les échecs de mutation vers les messages éphémères. */
function MutationErrorBridge() {
  const { notify } = useToasts();

  useEffect(() => {
    const handler = (event: Event) => notify((event as CustomEvent<string>).detail, 'error');
    window.addEventListener(MUTATION_ERROR_EVENT, handler);
    return () => window.removeEventListener(MUTATION_ERROR_EVENT, handler);
  }, [notify]);

  return null;
}

function Routing() {
  const { user, loading } = useSession();

  if (loading) return <LoadingBlock />;
  if (!user) return <LoginPage />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<LibraryPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/work/:workId" element={<WorkPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/queue" element={<QueuePage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastsProvider>
          <MutationErrorBridge />
          <SessionProvider>
            <Routing />
          </SessionProvider>
        </ToastsProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
