import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { PublicUser, UpdatePreferencesInput } from '@scanlib/shared';
import { api } from '../lib/api';
import { translate, type TranslationKey, type UiLanguage } from '../lib/i18n';

interface SessionValue {
  user: PublicUser | null;
  loading: boolean;
  language: UiLanguage;
  t: (key: TranslationKey) => string;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    displayName: string;
    inviteCode?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  savePreferences: (input: UpdatePreferencesInput) => Promise<void>;
  /** Recharge l'utilisateur depuis le serveur après une modification de profil. */
  refresh: () => Promise<void>;
  /** Reprend la main sur un compte avec un code de secours. */
  useRecoveryCode: (code: string, newPassword: string) => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Dernière identité connue, conservée pour le démarrage hors connexion.
 *
 * Sans elle, ouvrir l'application installée sans réseau affiche l'écran de
 * connexion — impossible à valider hors ligne — alors que la bibliothèque est
 * en cache local. La session serveur reste la seule autorité : dès qu'une
 * requête revient en 401, l'utilisateur est déconnecté pour de bon.
 */
const CACHED_USER_KEY = 'scanlib:user';

function readCachedUser(): PublicUser | null {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    return raw ? (JSON.parse(raw) as PublicUser) : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: PublicUser | null): void {
  try {
    if (user) localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(CACHED_USER_KEY);
  } catch {
    /* stockage indisponible : on se contente de la session en mémoire */
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then((response) => {
        setUser(response.user);
        writeCachedUser(response.user);
      })
      .catch((error: unknown) => {
        // Un 401 signifie « session terminée » ; une erreur réseau signifie
        // seulement « hors ligne » et ne doit pas déconnecter l'utilisateur.
        const status = (error as { status?: number }).status;
        const offline = status == null || !navigator.onLine;
        setUser(offline ? readCachedUser() : null);
        if (!offline) writeCachedUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  // Le thème est appliqué sur <html> pour couvrir aussi la couleur de fond du
  // navigateur pendant le chargement.
  useEffect(() => {
    const theme = user?.preferences.theme ?? 'system';
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    const light = theme === 'light' || (theme === 'system' && prefersLight);
    document.documentElement.classList.toggle('light', light);
    document.documentElement.classList.toggle('dark', !light);
  }, [user?.preferences.theme]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await api.login(email, password);
    setUser(response.user);
    writeCachedUser(response.user);
  }, []);

  const register = useCallback(
    async (input: { email: string; password: string; displayName: string; inviteCode?: string }) => {
      const response = await api.register(input);
      setUser(response.user);
      writeCachedUser(response.user);
    },
    [],
  );

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    writeCachedUser(null);
    setUser(null);
  }, []);

  const savePreferences = useCallback(async (input: UpdatePreferencesInput) => {
    const response = await api.updatePreferences(input);
    setUser((current) => {
      const next = current ? { ...current, preferences: response.preferences } : current;
      writeCachedUser(next);
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    const response = await api.me();
    setUser(response.user);
    writeCachedUser(response.user);
  }, []);

  const useRecoveryCode = useCallback(async (code: string, newPassword: string) => {
    const response = await api.useRecoveryCode(code, newPassword);
    setUser(response.user);
    writeCachedUser(response.user);
  }, []);

  const language = user?.preferences.uiLanguage ?? 'fr';

  const value = useMemo<SessionValue>(
    () => ({
      user,
      loading,
      language,
      t: (key: TranslationKey) => translate(key, language),
      login,
      register,
      logout,
      savePreferences,
      refresh,
      useRecoveryCode,
    }),
    [user, loading, language, login, register, logout, savePreferences, refresh, useRecoveryCode],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession doit être utilisé dans SessionProvider.');
  return value;
}

/** Raccourci pour les composants qui n'ont besoin que des traductions. */
export function useT(): (key: TranslationKey) => string {
  return useSession().t;
}
