import { BookOpen, ExternalLink, Info, Play, ShoppingCart } from 'lucide-react';
import type { LinkKind, OfficialLink } from '@scanlib/shared';
import { monetizationLabels } from '@scanlib/shared';
import { useSession } from '../hooks/useSession';
import { Badge, EmptyState, cn } from './ui';

const kindIcons: Record<LinkKind, typeof Play> = {
  stream: Play,
  read: BookOpen,
  buy: ShoppingCart,
  info: Info,
};

const kindTitles: Record<LinkKind, { fr: string; en: string }> = {
  stream: { fr: 'Regarder', en: 'Watch' },
  read: { fr: 'Lire', en: 'Read' },
  buy: { fr: 'Acheter', en: 'Buy' },
  info: { fr: 'Fiches et bases de données', en: 'Databases' },
};

/**
 * Liste des liens officiels, regroupés par usage.
 *
 * Deux informations comptent visuellement : la langue du contenu (c'est la
 * demande de départ — trouver la VF ou la VOSTFR sans chercher) et la nature
 * du lien, direct ou recherche, car aucune API ne fournit d'URL exacte pour les
 * catalogues français.
 */
export function LinkList({
  links,
  attributions,
}: {
  links: OfficialLink[];
  attributions: string[];
}) {
  const { language } = useSession();

  if (links.length === 0) {
    return (
      <EmptyState
        title="Aucun lien officiel trouvé"
        description="Aucune plateforme licenciée n'a été identifiée pour vos langues et régions. Élargissez vos préférences dans les Réglages."
      />
    );
  }

  const groups = (['stream', 'read', 'buy', 'info'] as LinkKind[])
    .map((kind) => ({ kind, items: links.filter((link) => link.kind === kind) }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const Icon = kindIcons[group.kind];
        return (
          <section key={group.kind}>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Icon size={15} />
              {kindTitles[group.kind][language]}
            </h3>
            <ul className="grid gap-2 lg:grid-cols-2 2xl:grid-cols-3">
              {group.items.map((link) => (
                <li key={`${link.platform}-${link.kind}-${link.region ?? ''}`}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      'flex min-h-14 items-center gap-3 rounded-xl border border-[var(--border)] px-3 py-2',
                      'transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--surface-hover)]',
                    )}
                  >
                    {link.logoUrl ? (
                      <img
                        src={link.logoUrl}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="size-8 shrink-0 rounded-md object-cover"
                      />
                    ) : (
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--surface-hover)] text-xs font-bold">
                        {link.platformLabel.slice(0, 2).toUpperCase()}
                      </span>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{link.platformLabel}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        {link.language ? (
                          <Badge color="var(--color-accent)">{link.language.toUpperCase()}</Badge>
                        ) : null}
                        {link.region ? (
                          <span className="text-[11px] text-[var(--text-muted)]">{link.region}</span>
                        ) : null}
                        <span className="text-[11px] text-[var(--text-muted)]">
                          {monetizationLabels[link.monetization][language]}
                        </span>
                        {link.confidence === 'search' ? (
                          <span
                            className="text-[11px] text-[var(--text-muted)] italic"
                            title="La plateforme ne publie pas de lien direct : ce lien lance une recherche sur son catalogue."
                          >
                            · recherche
                          </span>
                        ) : null}
                        {link.confidence === 'site' ? (
                          <span
                            className="text-[11px] text-[var(--text-muted)] italic"
                            title="Cette plateforme n'expose aucune URL de recherche stable : le lien ouvre son catalogue."
                          >
                            · catalogue
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {link.platform.startsWith('custom:') ? (
                      <Badge color="var(--color-accent)">Ma source</Badge>
                    ) : link.official ? (
                      <Badge color="var(--color-success)">Officiel</Badge>
                    ) : null}
                    <ExternalLink size={16} className="shrink-0 text-[var(--text-muted)]" />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {attributions.length > 0 ? (
        <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
          {attributions.join(' ')}
        </p>
      ) : null}
    </div>
  );
}
