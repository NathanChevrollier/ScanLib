import type {
  AddToLibraryInput,
  AdminOverview,
  AttachSourceInput,
  PushSubscriptionInput,
  SessionSummaryDto,
  UpdateUserInput,
  CalendarResponse,
  LibraryQuery,
  LibraryResponse,
  LinksResponse,
  NotificationsResponse,
  ProgressResponse,
  PublicUser,
  QueueResponse,
  Recommendation,
  ReleaseSchedule,
  ReleaseScheduleInput,
  ReleaseScheduleUpdate,
  ScheduleSuggestion,
  SchedulesResponse,
  SearchResponse,
  StatsResponse,
  UnitsResponse,
  UpdateEntryInput,
  UpdatePreferencesInput,
  UserPreferences,
  WorkResponse,
} from '@scanlib/shared';

const BASE = '/api';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let refreshing: Promise<boolean> | null = null;

/**
 * Client HTTP unique.
 *
 * Les jetons vivent dans des cookies httpOnly : le navigateur les envoie seul,
 * rien n'est lisible en JavaScript. Quand le jeton d'accès expire (15 min),
 * une seule tentative de renouvellement est lancée, mutualisée entre toutes les
 * requêtes en vol, puis la requête d'origine est rejouée.
 */
async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    ...init,
  });

  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    const renewed = await refreshSession();
    if (renewed) return request<T>(path, init, false);
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    throw new ApiError(
      payload?.error?.code ?? 'unknown',
      payload?.error?.message ?? `Erreur ${response.status}`,
      response.status,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      // Laisse la promesse résolue le temps du cycle courant puis la libère.
      setTimeout(() => {
        refreshing = null;
      }, 0);
    });
  return refreshing;
}

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) search.set(key, value.join(','));
    } else {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export const api = {
  /* --- Authentification ------------------------------------------------ */
  login: (email: string, password: string) =>
    request<{ user: PublicUser }>('/auth/login', json({ email, password })),
  register: (input: {
    email: string;
    password: string;
    displayName: string;
    inviteCode?: string;
  }) => request<{ user: PublicUser }>('/auth/register', json(input)),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  me: () => request<{ user: PublicUser }>('/auth/me'),
  createInvite: () => request<{ code: string; expiresAt: string }>('/auth/invites', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>('/auth/password', json({ currentPassword, newPassword })),
  useRecoveryCode: (code: string, newPassword: string) =>
    request<{ user: PublicUser }>('/auth/recovery', json({ code, newPassword })),
  updateProfile: (input: { displayName?: string; email?: string }) =>
    request<{ user: PublicUser }>('/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteAccount: (password: string) =>
    request<{ ok: boolean }>('/auth/account/delete', json({ password })),
  sessions: () => request<{ sessions: SessionSummaryDto[] }>('/auth/sessions'),
  revokeSession: (id: string) =>
    request<{ ok: boolean }>(`/auth/sessions/${id}`, { method: 'DELETE' }),
  revokeOtherSessions: () =>
    request<{ revoked: number }>('/auth/sessions/revoke-others', { method: 'POST' }),

  /* --- Administration ---------------------------------------------------- */
  adminOverview: () => request<AdminOverview>('/admin/overview'),
  adminUpdateUser: (id: string, input: UpdateUserInput) =>
    request<{ ok: boolean }>(`/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  adminRecoveryCode: (id: string) =>
    request<{ code: string; expiresAt: string }>(`/admin/users/${id}/recovery`, { method: 'POST' }),
  adminRevokeInvite: (code: string) =>
    request<{ ok: boolean }>(`/admin/invites/${code}`, { method: 'DELETE' }),
  adminRunJob: (job: string) =>
    request<{ started: string }>(`/admin/jobs/${job}/run`, { method: 'POST' }),

  /* --- Notifications poussées -------------------------------------------- */
  pushKey: () => request<{ enabled: boolean; publicKey: string | null }>('/push/key'),
  pushSubscribe: (subscription: PushSubscriptionInput) =>
    request<{ ok: boolean }>('/push/subscribe', json(subscription)),
  pushUnsubscribe: (endpoint: string) =>
    request<{ ok: boolean }>('/push/unsubscribe', json({ endpoint })),

  /* --- Recherche et fiches --------------------------------------------- */
  search: (params: { q: string; kinds?: string[]; limit?: number; offset?: number }) =>
    request<SearchResponse>(`/works/search${toQuery(params)}`),
  work: (workId: string) => request<WorkResponse>(`/works/${workId}`),
  units: (workId: string) => request<UnitsResponse>(`/works/${workId}/units`),
  links: (workId: string) => request<LinksResponse>(`/works/${workId}/links`),
  detachSource: (workId: string, provider: string) =>
    request<{ externals: unknown[] }>(`/works/${workId}/sources/${provider}`, {
      method: 'DELETE',
    }),
  attachSource: (workId: string, input: AttachSourceInput) =>
    request<{ externals: unknown[] }>(`/works/${workId}/sources`, json(input)),
  refreshWork: (workId: string) =>
    request<WorkResponse>(`/works/${workId}/refresh`, { method: 'POST' }),

  /* --- Bibliothèque ----------------------------------------------------- */
  library: (query: Partial<LibraryQuery>) => request<LibraryResponse>(`/library${toQuery(query)}`),
  addToLibrary: (input: AddToLibraryInput) => request<unknown>('/library', json(input)),
  updateEntry: (workId: string, input: UpdateEntryInput) =>
    request<unknown>(`/library/${workId}`, { method: 'PATCH', body: JSON.stringify(input) }),
  removeFromLibrary: (workId: string) =>
    request<{ ok: boolean }>(`/library/${workId}`, { method: 'DELETE' }),

  /* --- Progression ------------------------------------------------------ */
  setProgress: (unitIds: string[], completed: boolean) =>
    request<ProgressResponse>('/library/progress', json({ unitIds, completed })),
  markUpTo: (workId: string, number: number) =>
    request<ProgressResponse>('/library/progress/up-to', json({ workId, number })),
  setProgressNumber: (workId: string, number: number) =>
    request<ProgressResponse>('/library/progress/set', json({ workId, number })),

  /* --- Vues transverses -------------------------------------------------- */
  calendar: (from?: string, to?: string) =>
    request<CalendarResponse>(`/calendar${toQuery({ from, to })}`),
  schedules: () => request<SchedulesResponse>('/calendar/schedules'),
  suggestSchedule: (workId: string) =>
    request<{ suggestion: ScheduleSuggestion }>(
      `/calendar/schedules/suggest${toQuery({ workId })}`,
    ),
  createSchedule: (input: ReleaseScheduleInput) =>
    request<{ schedule: ReleaseSchedule }>('/calendar/schedules', json(input)),
  updateSchedule: (id: string, input: ReleaseScheduleUpdate) =>
    request<{ schedule: ReleaseSchedule }>(`/calendar/schedules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteSchedule: (id: string) =>
    request<{ ok: boolean }>(`/calendar/schedules/${id}`, { method: 'DELETE' }),
  stats: () => request<StatsResponse>('/stats'),
  queue: () => request<QueueResponse>('/queue'),
  recommendations: () => request<{ recommendations: Recommendation[] }>('/recommendations'),
  notifications: () => request<NotificationsResponse>('/notifications'),
  markNotificationsRead: () => request<{ ok: boolean }>('/notifications/read', { method: 'POST' }),

  /* --- Réglages ---------------------------------------------------------- */
  updatePreferences: (input: UpdatePreferencesInput) =>
    request<{ preferences: UserPreferences }>('/preferences', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  providerHealth: () =>
    request<{
      providers: { provider: string; status: string; message: string | null; checkedAt: string }[];
    }>('/health/providers'),
  exportLibrary: () => request<Record<string, unknown>>('/export'),
};
