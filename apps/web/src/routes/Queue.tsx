import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import type { LibraryItem, Recommendation } from '@scanlib/shared';
import { api } from '../lib/api';
import { useSession } from '../hooks/useSession';
import { Cover, LibraryCard } from '../components/WorkCard';
import { Button, EmptyState, LoadingBlock, SectionTitle } from '../components/ui';

/**
 * Écran « qu'est-ce que je fais maintenant ? » : ce qui attend d'être commencé,
 * ce qui a des épisodes en réserve, ce qui traîne depuis un mois, et des
 * suggestions basées sur les séries les mieux notées.
 */
export function QueuePage() {
  const { t } = useSession();
  const navigate = useNavigate();

  const queue = useQuery({ queryKey: ['queue'], queryFn: () => api.queue(), staleTime: 60_000 });
  const recommendations = useQuery({
    queryKey: ['recommendations'],
    queryFn: () => api.recommendations(),
    staleTime: 30 * 60_000,
  });

  const openNext = (item: LibraryItem) => {
    const url = item.nextUnit?.externalUrl;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    else navigate(`/work/${item.work.id}`);
  };

  if (queue.isPending) return <LoadingBlock />;

  const sections: [string, LibraryItem[], string][] = [
    [t('queue.binge'), queue.data?.readyToBinge ?? [], 'Des unités disponibles vous attendent.'],
    [t('queue.toStart'), queue.data?.toStart ?? [], 'Vos prochaines découvertes, par priorité.'],
    [t('queue.stalled'), queue.data?.stalled ?? [], 'Sans activité depuis plus de 30 jours.'],
  ];

  const empty = sections.every(([, items]) => items.length === 0);

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">{t('nav.queue')}</h1>

      {empty ? (
        <EmptyState
          title="Rien en attente"
          description="Ajoutez des séries à votre bibliothèque pour voir apparaître vos files."
          action={
            <Button variant="primary" onClick={() => navigate('/search')}>
              {t('common.search')}
            </Button>
          }
        />
      ) : (
        sections.map(([title, items, hint]) =>
          items.length > 0 ? (
            <section key={title}>
              <SectionTitle title={title} hint={hint} />
              <div className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-10">
                {items.map((item) => (
                  <LibraryCard key={item.entry.id} item={item} onContinue={openNext} />
                ))}
              </div>
            </section>
          ) : null,
        )
      )}

      <section>
        <SectionTitle
          title={t('queue.recommendations')}
          hint="À partir de vos séries les mieux notées."
        />
        {recommendations.isPending ? (
          <LoadingBlock />
        ) : (recommendations.data?.recommendations.length ?? 0) === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            Notez quelques séries terminées pour obtenir des suggestions.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-10">
            {recommendations.data!.recommendations.map((item) => (
              <RecommendationCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function RecommendationCard({ item }: { item: Recommendation }) {
  const queryClient = useQueryClient();

  const add = useMutation({
    mutationFn: () =>
      api.addToLibrary({
        provider: item.provider,
        providerId: item.providerId,
        kind: item.kind,
        status: 'planned',
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['library'] });
      await queryClient.invalidateQueries({ queryKey: ['recommendations'] });
    },
  });

  return (
    <div>
      <Cover work={item} />
      <p className="mt-2 line-clamp-2 text-sm font-medium">{item.title}</p>
      <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--text-muted)]">{item.reason}</p>
      <Button
        className="mt-2 w-full"
        icon={<Sparkles size={13} />}
        loading={add.isPending}
        onClick={() => add.mutate()}
      >
        Ajouter
      </Button>
    </div>
  );
}
