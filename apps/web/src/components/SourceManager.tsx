import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Link2Off, Plus } from 'lucide-react';
import type { ExternalRef, ProviderId } from '@scanlib/shared';
import { providerIds } from '@scanlib/shared';
import { api } from '../lib/api';
import { useToasts } from '../hooks/useToasts';
import { Button, cn, inputClass, selectClass } from './ui';

/**
 * Sources rattachées à une œuvre.
 *
 * Le rapprochement automatique se trompe forcément parfois : deux éditions
 * fusionnées à tort, ou une source qui décrit en réalité une autre série. Sans
 * ce panneau, l'erreur était définitive — la fiche restait fausse pour toujours.
 */
export function SourceManager({
  workId,
  externals,
}: {
  workId: string;
  externals: ExternalRef[];
}) {
  const { notify } = useToasts();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [provider, setProvider] = useState<ProviderId>('mangadex');
  const [providerId, setProviderId] = useState('');

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['work', workId] });
    await queryClient.invalidateQueries({ queryKey: ['links', workId] });
    await queryClient.invalidateQueries({ queryKey: ['units', workId] });
  };

  const detach = useMutation({
    mutationFn: (source: ProviderId) => api.detachSource(workId, source),
    onSuccess: async () => {
      await invalidate();
      notify('Source détachée.', 'success');
    },
  });

  const attach = useMutation({
    mutationFn: () => api.attachSource(workId, { provider, providerId: providerId.trim() }),
    onSuccess: async () => {
      await invalidate();
      setProviderId('');
      setAdding(false);
      notify('Source rattachée.', 'success');
    },
  });

  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {externals.map((external) => (
          <li
            key={`${external.provider}-${external.providerId}`}
            className="flex items-center gap-2 text-xs"
          >
            <span className="w-20 font-medium">{external.provider}</span>
            <code className="min-w-0 flex-1 truncate text-[var(--text-muted)]">
              {external.providerId}
            </code>

            {external.url ? (
              <a
                href={external.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Ouvrir sur ${external.provider}`}
                className="flex size-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              >
                <ExternalLink size={13} />
              </a>
            ) : null}

            <button
              type="button"
              aria-label={`Détacher ${external.provider}`}
              title="Cette source ne correspond pas à cette œuvre"
              disabled={detach.isPending || externals.length <= 1}
              onClick={() => detach.mutate(external.provider)}
              className={cn(
                'flex size-8 items-center justify-center rounded-lg text-[var(--text-muted)]',
                'hover:bg-[var(--surface-hover)] hover:text-[var(--color-danger)] disabled:opacity-40',
              )}
            >
              <Link2Off size={13} />
            </button>
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value as ProviderId)}
            aria-label="Source"
            className={cn(selectClass, 'h-9 min-h-0 py-0 text-xs')}
          >
            {providerIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <input
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
            placeholder="Identifiant sur cette source"
            aria-label="Identifiant"
            className={cn(inputClass, 'h-9 min-h-0 flex-1 text-xs')}
          />
          <Button
            variant="primary"
            loading={attach.isPending}
            disabled={!providerId.trim()}
            onClick={() => attach.mutate()}
          >
            Rattacher
          </Button>
          <Button variant="ghost" onClick={() => setAdding(false)}>
            Annuler
          </Button>
        </div>
      ) : (
        <Button variant="ghost" icon={<Plus size={14} />} onClick={() => setAdding(true)}>
          Rattacher une source
        </Button>
      )}
    </div>
  );
}
