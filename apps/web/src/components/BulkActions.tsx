import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckSquare, Trash2, X } from 'lucide-react';
import type { LibraryStatus } from '@scanlib/shared';
import { libraryStatusColors, libraryStatusLabels, libraryStatuses } from '@scanlib/shared';
import { api } from '../lib/api';
import { useSession } from '../hooks/useSession';
import { useToasts } from '../hooks/useToasts';
import { Button, cn, selectClass } from './ui';

/**
 * Barre d'actions groupées.
 *
 * Passer dix séries en « abandonné » demandait dix allers-retours dans les
 * fiches. La barre n'apparaît que lorsqu'une sélection existe, pour ne pas
 * encombrer l'écran le reste du temps.
 */
export function BulkActions({
  selected,
  onClear,
}: {
  selected: string[];
  onClear: () => void;
}) {
  const { language } = useSession();
  const { notify } = useToasts();
  const queryClient = useQueryClient();

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['library'] });
    await queryClient.invalidateQueries({ queryKey: ['queue'] });
    onClear();
  };

  const setStatus = useMutation({
    mutationFn: async (status: LibraryStatus) => {
      // Les requêtes partent en série : une bibliothèque se modifie rarement à
      // plus de quelques dizaines d'éléments, et le serveur reste tranquille.
      for (const workId of selected) {
        await api.updateEntry(workId, { status });
      }
    },
    onSuccess: async (_result, status) => {
      await refresh();
      notify(
        `${selected.length} œuvre(s) passée(s) en « ${libraryStatusLabels[status][language]} ».`,
        'success',
      );
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      for (const workId of selected) {
        await api.removeFromLibrary(workId);
      }
    },
    onSuccess: async () => {
      await refresh();
      notify(`${selected.length} œuvre(s) retirée(s) de la bibliothèque.`, 'success');
    },
  });

  if (selected.length === 0) return null;
  const busy = setStatus.isPending || remove.isPending;

  return (
    <div
      className={cn(
        'sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2',
        'border-[var(--color-accent)] bg-[var(--surface-raised)] shadow-lg',
      )}
    >
      <CheckSquare size={16} className="text-[var(--color-accent)]" />
      <span className="text-sm font-medium">{selected.length} sélectionnée(s)</span>

      <select
        defaultValue=""
        disabled={busy}
        onChange={(event) => {
          if (event.target.value) setStatus.mutate(event.target.value as LibraryStatus);
          event.target.value = '';
        }}
        aria-label="Changer le statut de la sélection"
        className={cn(selectClass, 'h-9 min-h-0 py-0 text-xs')}
      >
        <option value="">Changer le statut…</option>
        {libraryStatuses.map((status) => (
          <option key={status} value={status} style={{ color: libraryStatusColors[status] }}>
            {libraryStatusLabels[status][language]}
          </option>
        ))}
      </select>

      <Button
        variant="danger"
        icon={<Trash2 size={14} />}
        loading={remove.isPending}
        onClick={() => remove.mutate()}
      >
        Retirer
      </Button>

      <Button variant="ghost" icon={<X size={14} />} onClick={onClear}>
        Annuler
      </Button>
    </div>
  );
}
