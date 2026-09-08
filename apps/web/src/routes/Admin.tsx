import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Play, ShieldCheck, Trash2, UserMinus, UserPlus } from 'lucide-react';
import type { AdminUser } from '@scanlib/shared';
import { api } from '../lib/api';
import { formatAgo } from '../lib/format';
import { useSession } from '../hooks/useSession';
import { useToasts } from '../hooks/useToasts';
import { Badge, Button, Card, ErrorState, LoadingBlock, SectionTitle, cn } from '../components/ui';

const JOBS = [
  { id: 'detect-new-units', label: 'Détecter les nouveautés' },
  { id: 'refresh-metadata', label: 'Rafraîchir les métadonnées' },
  { id: 'airing-calendar', label: 'Mettre à jour le calendrier' },
  { id: 'refresh-links', label: 'Recalculer les liens' },
  { id: 'verify-platforms', label: 'Vérifier les plateformes' },
  { id: 'maintenance', label: 'Entretien' },
];

/**
 * Administration de l'instance.
 *
 * Sans cet écran, l'administrateur était aveugle : il pouvait créer une
 * invitation sans jamais voir celles en cours, ni savoir si les tâches de fond
 * tournaient, ni aider quelqu'un ayant perdu son mot de passe.
 */
export function AdminPage() {
  const { user } = useSession();
  const { notify } = useToasts();
  const queryClient = useQueryClient();

  const overview = useQuery({
    queryKey: ['admin-overview'],
    queryFn: () => api.adminOverview(),
    refetchInterval: 60_000,
  });

  const updateUser = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.adminUpdateUser>[1] }) =>
      api.adminUpdateUser(id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
      notify('Compte mis à jour.', 'success');
    },
  });

  const recovery = useMutation({
    mutationFn: (id: string) => api.adminRecoveryCode(id),
    onSuccess: async (result) => {
      await navigator.clipboard.writeText(result.code).catch(() => undefined);
      notify(`Code de secours copié : ${result.code}`, 'success');
    },
  });

  const revokeInvite = useMutation({
    mutationFn: (code: string) => api.adminRevokeInvite(code),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
      notify('Invitation annulée.', 'success');
    },
  });

  const createInvite = useMutation({
    mutationFn: () => api.createInvite(),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
      await navigator.clipboard.writeText(result.code).catch(() => undefined);
      notify(`Invitation créée et copiée : ${result.code}`, 'success');
    },
  });

  const runJob = useMutation({
    mutationFn: (job: string) => api.adminRunJob(job),
    onSuccess: (result) => notify(`Tâche « ${result.started} » lancée.`, 'info'),
  });

  // Un compte non administrateur n'a rien à faire ici.
  if (user && user.role !== 'admin') return <Navigate to="/settings" replace />;
  if (overview.isPending) return <LoadingBlock />;
  if (overview.isError) {
    return (
      <ErrorState message={(overview.error as Error).message} onRetry={() => overview.refetch()} />
    );
  }

  const { users, invites, jobs } = overview.data;
  const pendingInvites = invites.filter((invite) => !invite.usedBy);

  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="text-xl font-semibold">Administration</h1>

      <Card className="p-4">
        <SectionTitle title={`Comptes (${users.length})`} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] tracking-wide text-[var(--text-muted)] uppercase">
                <th className="pb-2 font-medium">Compte</th>
                <th className="pb-2 font-medium">Bibliothèque</th>
                <th className="pb-2 font-medium">Dernière connexion</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {users.map((row) => (
                <UserRow
                  key={row.id}
                  row={row}
                  isSelf={row.id === user?.id}
                  busy={updateUser.isPending || recovery.isPending}
                  onToggleRole={() =>
                    updateUser.mutate({
                      id: row.id,
                      input: { role: row.role === 'admin' ? 'user' : 'admin' },
                    })
                  }
                  onToggleDisabled={() =>
                    updateUser.mutate({ id: row.id, input: { disabled: !row.disabled } })
                  }
                  onRecovery={() => recovery.mutate(row.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4">
        <SectionTitle
          title={`Invitations en attente (${pendingInvites.length})`}
          hint="Chaque code est valable 14 jours et ne sert qu'une fois."
          action={
            <Button
              icon={<UserPlus size={15} />}
              loading={createInvite.isPending}
              onClick={() => createInvite.mutate()}
            >
              Créer
            </Button>
          }
        />

        {pendingInvites.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">Aucune invitation en attente.</p>
        ) : (
          <ul className="space-y-2">
            {pendingInvites.map((invite) => (
              <li
                key={invite.code}
                className="flex items-center gap-3 rounded-xl border border-[var(--border)] px-3 py-2"
              >
                <code className="flex-1 font-mono text-sm">{invite.code}</code>
                <span className="text-[11px] text-[var(--text-muted)]">
                  {invite.expiresAt ? `expire ${formatAgo(invite.expiresAt)}` : 'sans expiration'}
                </span>
                <button
                  type="button"
                  aria-label="Copier"
                  onClick={() => void navigator.clipboard.writeText(invite.code)}
                  className="flex size-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
                >
                  <Copy size={15} />
                </button>
                <button
                  type="button"
                  aria-label="Annuler cette invitation"
                  onClick={() => revokeInvite.mutate(invite.code)}
                  className="flex size-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-danger)]"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <SectionTitle
          title="Tâches de fond"
          hint="Dernière exécution de chacune. Une tâche en échec se voit ici plutôt que dans les journaux."
        />

        <ul className="space-y-2">
          {JOBS.map((job) => {
            const run = jobs.find((item) => item.job === job.id);
            return (
              <li
                key={job.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] px-3 py-2"
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      run == null
                        ? 'var(--text-muted)'
                        : run.success === false
                          ? 'var(--color-danger)'
                          : run.finishedAt == null
                            ? 'var(--color-warning)'
                            : 'var(--color-success)',
                  }}
                  aria-hidden
                />
                <span className="min-w-40 flex-1 text-sm">{job.label}</span>

                <span className="text-[11px] text-[var(--text-muted)]">
                  {run
                    ? run.finishedAt == null
                      ? 'en cours…'
                      : `${formatAgo(run.startedAt)} · ${Math.round((run.durationMs ?? 0) / 1000)} s`
                    : 'jamais exécutée'}
                </span>

                {run?.error ? (
                  <span className="w-full truncate text-[11px] text-[var(--color-danger)]">
                    {run.error}
                  </span>
                ) : run?.result ? (
                  <span className="w-full truncate text-[11px] text-[var(--text-muted)]">
                    {Object.entries(run.result)
                      .map(([key, value]) => `${key} : ${JSON.stringify(value)}`)
                      .join(' · ')}
                  </span>
                ) : null}

                <Button
                  variant="ghost"
                  icon={<Play size={14} />}
                  loading={runJob.isPending}
                  onClick={() => runJob.mutate(job.id)}
                >
                  Lancer
                </Button>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

function UserRow({
  row,
  isSelf,
  busy,
  onToggleRole,
  onToggleDisabled,
  onRecovery,
}: {
  row: AdminUser;
  isSelf: boolean;
  busy: boolean;
  onToggleRole: () => void;
  onToggleDisabled: () => void;
  onRecovery: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <tr className={cn(row.disabled && 'opacity-60')}>
      <td className="py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.displayName}</span>
          {row.role === 'admin' ? (
            <Badge color="var(--color-accent)">
              <ShieldCheck size={11} /> Admin
            </Badge>
          ) : null}
          {row.disabled ? <Badge color="var(--color-danger)">Suspendu</Badge> : null}
        </div>
        <p className="text-[11px] text-[var(--text-muted)]">{row.email}</p>
      </td>
      <td className="py-2.5 text-sm tabular-nums text-[var(--text-muted)]">{row.worksCount}</td>
      <td className="py-2.5 text-sm text-[var(--text-muted)]">
        {row.lastLoginAt ? formatAgo(row.lastLoginAt) : 'jamais'}
      </td>
      <td className="py-2.5">
        <div className="flex justify-end gap-1">
          <button
            type="button"
            aria-label="Générer un code de secours"
            title="Générer un code de secours"
            disabled={busy}
            onClick={onRecovery}
            className="flex size-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            <KeyRound size={15} />
          </button>

          {!isSelf ? (
            <>
              <button
                type="button"
                aria-label={row.role === 'admin' ? 'Retirer les droits' : 'Donner les droits'}
                title={row.role === 'admin' ? 'Retirer les droits' : 'Donner les droits'}
                disabled={busy}
                onClick={onToggleRole}
                className="flex size-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              >
                <ShieldCheck size={15} />
              </button>
              <button
                type="button"
                aria-label={row.disabled ? 'Réactiver le compte' : 'Suspendre le compte'}
                title={row.disabled ? 'Réactiver le compte' : 'Suspendre le compte'}
                disabled={busy}
                onClick={() => {
                  if (row.disabled || confirming) {
                    onToggleDisabled();
                    setConfirming(false);
                  } else setConfirming(true);
                }}
                className={cn(
                  'flex size-9 items-center justify-center rounded-lg',
                  confirming
                    ? 'bg-[var(--color-danger)] text-white'
                    : 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-danger)]',
                )}
              >
                <UserMinus size={15} />
              </button>
            </>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
