import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, Laptop, LogOut, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { formatAgo } from '../lib/format';
import { disablePush, enablePush, pushStatus } from '../lib/push';
import { useSession } from '../hooks/useSession';
import { useToasts } from '../hooks/useToasts';
import { Badge, Button, Card, CardGrid, Field, SectionTitle, Spinner, inputClass } from './ui';

/**
 * Tout ce qui touche au compte lui-même : identité, mot de passe, appareils
 * connectés, notifications, suppression.
 *
 * Ces gestes étaient jusqu'ici impossibles depuis l'application — changer son
 * mot de passe demandait de recréer le compte en ligne de commande, ce qui
 * faisait perdre la bibliothèque.
 */
export function AccountSettings() {
  const { user, logout } = useSession();
  const { notify } = useToasts();

  if (!user) return null;

  return (
    <CardGrid>
      <Card className="p-5">
        <ProfileForm />
      </Card>
      <Card className="p-5">
        <PasswordForm />
      </Card>
      <Card className="p-5">
        <PushToggle />
      </Card>
      <Card className="p-5">
        <SessionsList />
      </Card>
      <Card className="p-5">
        <DangerZone onDeleted={() => void logout().then(() => notify('Compte supprimé.', 'info'))} />
      </Card>
    </CardGrid>
  );
}

/* --- Identité ------------------------------------------------------------ */

function ProfileForm() {
  const { user, refresh } = useSession();
  const { notify } = useToasts();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');

  const save = useMutation({
    mutationFn: () => api.updateProfile({ displayName, email }),
    onSuccess: async () => {
      await refresh();
      notify('Profil enregistré.', 'success');
    },
  });

  const changed = displayName !== user?.displayName || email !== user?.email;

  return (
    <section className="space-y-3">
      <SectionTitle title="Identité" />
      <div className="grid gap-3">
        <Field label="Nom affiché">
          <input
            className={inputClass}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>
        <Field label="Adresse e-mail">
          <input
            type="email"
            className={inputClass}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
      </div>
      {changed ? (
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
          Enregistrer
        </Button>
      ) : null}
    </section>
  );
}

/* --- Mot de passe -------------------------------------------------------- */

function PasswordForm() {
  const { notify } = useToasts();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setConfirm('');
      setError(null);
      notify('Mot de passe modifié. Vos autres appareils ont été déconnectés.', 'success');
    },
    onError: (caught) => setError(caught instanceof Error ? caught.message : 'Échec.'),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (next.length < 10) {
      setError('Le nouveau mot de passe doit faire au moins 10 caractères.');
      return;
    }
    if (next !== confirm) {
      setError('Les deux saisies ne correspondent pas.');
      return;
    }
    change.mutate();
  };

  return (
    <section className="space-y-3">
      <SectionTitle
        title="Mot de passe"
        hint="Le changer déconnecte tous vos autres appareils."
      />
      <form onSubmit={submit} className="grid gap-3">
        <Field label="Mot de passe actuel">
          <input
            type="password"
            autoComplete="current-password"
            className={inputClass}
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </Field>
        <Field label="Nouveau">
          <input
            type="password"
            autoComplete="new-password"
            className={inputClass}
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
        </Field>
        <Field label="Confirmation">
          <input
            type="password"
            autoComplete="new-password"
            className={inputClass}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </Field>

        {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}

        <div>
          <Button
            type="submit"
            variant="primary"
            loading={change.isPending}
            disabled={!current || !next}
          >
            Changer le mot de passe
          </Button>
        </div>
      </form>
    </section>
  );
}

/* --- Notifications poussées ---------------------------------------------- */

function PushToggle() {
  const { notify } = useToasts();
  const status = useQuery({ queryKey: ['push-status'], queryFn: pushStatus });

  const toggle = useMutation({
    mutationFn: async (enable: boolean) => (enable ? enablePush() : disablePush()),
    onSuccess: async (_result, enable) => {
      await status.refetch();
      notify(
        enable ? 'Notifications activées sur cet appareil.' : 'Notifications désactivées.',
        'success',
      );
    },
  });

  // La fiche existe déjà dans la grille : un `null` y laisserait un trou.
  if (!status.data) {
    return (
      <section className="space-y-2">
        <SectionTitle title="Notifications" />
        <Spinner />
      </section>
    );
  }

  if (!status.data.available) {
    return (
      <section className="space-y-2">
        <SectionTitle title="Notifications" />
        <p className="text-sm text-[var(--text-muted)]">
          {status.data.reason ??
            "Indisponible sur cet appareil. Les notifications restent visibles dans l'application."}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <SectionTitle
        title="Notifications"
        hint="Être prévenu de la sortie d'un chapitre sans ouvrir l'application."
      />
      <Button
        icon={status.data.subscribed ? <BellOff size={16} /> : <Bell size={16} />}
        loading={toggle.isPending}
        onClick={() => toggle.mutate(!status.data.subscribed)}
      >
        {status.data.subscribed ? 'Désactiver sur cet appareil' : 'Activer sur cet appareil'}
      </Button>
    </section>
  );
}

/* --- Appareils connectés -------------------------------------------------- */

function SessionsList() {
  const { language } = useSession();
  const { notify } = useToasts();
  const queryClient = useQueryClient();

  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.sessions() });

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeSession(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
      notify('Appareil déconnecté.', 'success');
    },
  });

  const revokeOthers = useMutation({
    mutationFn: () => api.revokeOtherSessions(),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
      notify(`${result.revoked} appareil(s) déconnecté(s).`, 'success');
    },
  });

  const list = sessions.data?.sessions ?? [];

  return (
    <section className="space-y-3">
      <SectionTitle
        title="Appareils connectés"
        hint="Chaque connexion ouvre une session. Révoquez celles que vous ne reconnaissez pas."
        action={
          list.length > 1 ? (
            <Button
              icon={<LogOut size={15} />}
              loading={revokeOthers.isPending}
              onClick={() => revokeOthers.mutate()}
            >
              Déconnecter les autres
            </Button>
          ) : undefined
        }
      />

      <ul className="space-y-2">
        {list.map((session) => (
          <li
            key={session.id}
            className="flex items-center gap-3 rounded-xl border border-[var(--border)] px-3 py-2"
          >
            <Laptop size={16} className="shrink-0 text-[var(--text-muted)]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{describeDevice(session.userAgent)}</p>
              <p className="text-[11px] text-[var(--text-muted)]">
                Connecté {formatAgo(session.createdAt, language)}
              </p>
            </div>
            {session.current ? (
              <Badge color="var(--color-success)">Cet appareil</Badge>
            ) : (
              <button
                type="button"
                aria-label="Déconnecter cet appareil"
                onClick={() => revoke.mutate(session.id)}
                className="flex size-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-danger)]"
              >
                <LogOut size={15} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Résumé lisible d'un agent utilisateur : le nom du navigateur et du système
 * suffisent à reconnaître un appareil, la chaîne complète est illisible.
 */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Appareil inconnu';

  const browser =
    /Edg\//.test(userAgent) ? 'Edge'
    : /Firefox\//.test(userAgent) ? 'Firefox'
    : /Chrome\//.test(userAgent) ? 'Chrome'
    : /Safari\//.test(userAgent) ? 'Safari'
    : 'Navigateur';

  const system =
    /Android/.test(userAgent) ? 'Android'
    : /iPhone|iPad/.test(userAgent) ? 'iOS'
    : /Windows/.test(userAgent) ? 'Windows'
    : /Mac OS/.test(userAgent) ? 'macOS'
    : /Linux/.test(userAgent) ? 'Linux'
    : '';

  return system ? `${browser} sur ${system}` : browser;
}

/* --- Suppression ---------------------------------------------------------- */

function DangerZone({ onDeleted }: { onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');

  const remove = useMutation({
    mutationFn: () => api.deleteAccount(password),
    onSuccess: onDeleted,
  });

  return (
    <section className="space-y-3">
      <SectionTitle
        title="Supprimer mon compte"
        hint="Bibliothèque, progression et historique sont effacés définitivement."
      />

      {open ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Confirmez avec votre mot de passe">
            <input
              type="password"
              className={inputClass}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Button
            variant="danger"
            icon={<Trash2 size={15} />}
            loading={remove.isPending}
            disabled={!password}
            onClick={() => remove.mutate()}
          >
            Supprimer définitivement
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Annuler
          </Button>
        </div>
      ) : (
        <Button variant="ghost" icon={<Trash2 size={15} />} onClick={() => setOpen(true)}>
          Supprimer mon compte
        </Button>
      )}
    </section>
  );
}
