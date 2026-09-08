import type { CustomPlatform, ExternalRef, OfficialLink, Titles, WorkKind } from '@scanlib/shared';
import { TMDB_ATTRIBUTION } from '../adapters/tmdb.js';
import type { ProviderRegistry } from '../registry.js';
import type { Logger } from '../types.js';
import { platformUrl, suggestedPlatforms } from './platforms.js';

export interface ResolveOptions {
  /** Langues préférées, par ordre décroissant. */
  languages: string[];
  /** Régions de disponibilité à interroger. */
  regions: string[];
  /** Plateformes possédées par l'utilisateur : remontées en tête. */
  ownedPlatforms?: string[];
  /** Sources déclarées par l'utilisateur, prioritaires sur le registre livré. */
  customPlatforms?: CustomPlatform[];
  /** Masque les sources non officielles (bases de données, scantrad). */
  officialOnly?: boolean;
}

export interface ResolvedLinks {
  links: OfficialLink[];
  attributions: string[];
}

export interface ResolvableWork {
  kind: WorkKind;
  title: string;
  titles: Titles;
  externals: ExternalRef[];
}

/**
 * Assemble les liens de lecture et de visionnage d'une œuvre.
 *
 * Quatre sources, par ordre de fiabilité décroissante :
 *  1. les liens directs publiés par les providers (Jikan `streaming`, MangaDex
 *     `links` et chapitres `externalUrl`, AniList `externalLinks`) ;
 *  2. la disponibilité par pays de TMDB / JustWatch, qui nomme les plateformes
 *     sans donner d'URL vers l'œuvre ;
 *  3. les sources déclarées par l'utilisateur dans ses réglages ;
 *  4. le registre de plateformes vérifiées, qui fabrique une URL de recherche
 *     ou, à défaut, ouvre le catalogue de la plateforme.
 */
export class OfficialLinkResolver {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly logger?: Logger,
  ) {}

  async resolve(work: ResolvableWork, options: ResolveOptions): Promise<ResolvedLinks> {
    const collected: OfficialLink[] = [];
    const attributions = new Set<string>();

    await Promise.all(
      work.externals.map(async (external) => {
        const provider = this.registry.get(external.provider);
        if (!provider?.enabled || !provider.links) return;
        try {
          const links = await provider.links(external.providerId, work.kind, options.regions);
          collected.push(...links);
          if (external.provider === 'tmdb' && links.length > 0) {
            attributions.add(TMDB_ATTRIBUTION);
          }
        } catch (error) {
          this.logger?.warn('liens indisponibles', {
            provider: external.provider,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );

    const title = this.searchTitle(work, options);
    collected.push(...customLinks(work, title, options));
    collected.push(...registryLinks(work, title, options));

    const links = dedupe(collected)
      .filter((link) => (options.officialOnly ? link.official || link.kind === 'info' : true))
      .sort(compare(options));

    return { links, attributions: [...attributions] };
  }

  /**
   * Titre à utiliser pour les recherches. Les catalogues français indexent les
   * titres français, les catalogues anglophones les titres anglais : on prend
   * celui qui correspond à la langue préférée, avec repli sur l'anglais.
   */
  private searchTitle(work: ResolvableWork, options: ResolveOptions): string {
    for (const language of options.languages) {
      const candidate = work.titles[language];
      if (candidate) return candidate;
    }
    return work.titles.en ?? work.titles.romaji ?? work.title;
  }
}

/**
 * Ajoute les sources personnelles à une liste de liens déjà calculée, puis
 * remet le tout dans l'ordre.
 *
 * Les liens issus des API sont mis en cache pour toute l'instance ; les sources
 * personnalisées, elles, varient d'un compte à l'autre et ne coûtent rien à
 * fabriquer (une substitution de chaîne). On les ajoute donc à la lecture
 * plutôt que de rendre le cache dépendant de l'utilisateur.
 */
export function withCustomPlatforms(
  links: OfficialLink[],
  work: ResolvableWork,
  options: ResolveOptions,
): OfficialLink[] {
  if (!options.customPlatforms?.length) return [...links].sort(compare(options));

  const title =
    options.languages.map((lang) => work.titles[lang]).find(Boolean) ??
    work.titles.en ??
    work.title;

  const existing = new Set(links.map((link) => link.platform));
  const additions = customLinks(work, title, options).filter(
    (link) => !existing.has(link.platform),
  );

  return [...links, ...additions].sort(compare(options));
}

/** Liens issus des sources déclarées par l'utilisateur. */
function customLinks(
  work: ResolvableWork,
  title: string,
  options: ResolveOptions,
): OfficialLink[] {
  return (options.customPlatforms ?? [])
    .filter((platform) => platform.worksFor.length === 0 || platform.worksFor.includes(work.kind))
    .map((platform) => ({
      platform: `custom:${platform.id}`,
      platformLabel: platform.label,
      kind: platform.kind,
      url: platform.urlTemplate.replaceAll('{titre}', encodeURIComponent(title)),
      language: platform.language,
      region: null,
      monetization: 'unknown' as const,
      confidence: 'search' as const,
      // Une source ajoutée par l'utilisateur n'engage que lui : elle n'est pas
      // présentée comme officielle, mais reste affichée en priorité.
      official: false,
      source: 'registry' as const,
      logoUrl: null,
    }));
}

/** Liens de secours construits depuis le registre de plateformes vérifiées. */
function registryLinks(
  work: ResolvableWork,
  title: string,
  options: ResolveOptions,
): OfficialLink[] {
  const links: OfficialLink[] = [];

  for (const platform of suggestedPlatforms(work.kind, options.languages, options.regions)) {
    const target = platformUrl(platform, title);
    if (!target) continue;
    links.push({
      platform: platform.id,
      platformLabel: platform.label,
      kind: platform.kind,
      url: target.url,
      language: platform.languages.find((lang) => options.languages.includes(lang)) ?? null,
      region: platform.regions.find((region) => options.regions.includes(region)) ?? null,
      monetization: platform.monetization,
      confidence: target.confidence,
      official: platform.official,
      source: 'registry',
      logoUrl: null,
    });
  }

  return links;
}

/**
 * Un même service arrive de plusieurs sources avec des informations
 * complémentaires : Jikan donne l'URL directe vers l'œuvre sans savoir dans
 * quels pays elle est disponible, TMDB connaît les pays mais pas l'URL, et le
 * registre ne sait fabriquer qu'une recherche.
 *
 * On fusionne donc par plateforme et par type : la meilleure URL du groupe est
 * appliquée à chaque région connue. Sans cette mise en commun, un lien de
 * recherche régional masquerait le lien direct, qui est pourtant le seul utile.
 */
function dedupe(links: OfficialLink[]): OfficialLink[] {
  const groups = new Map<string, OfficialLink[]>();

  for (const link of links) {
    const key = `${link.platform}|${link.kind}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(link);
    else groups.set(key, [link]);
  }

  const result: OfficialLink[] = [];

  for (const group of groups.values()) {
    const best = group.reduce((a, b) => (score(b) > score(a) ? b : a));
    const logoUrl = group.find((link) => link.logoUrl)?.logoUrl ?? null;
    const regions = [...new Set(group.map((link) => link.region).filter(Boolean))] as string[];

    if (regions.length === 0) {
      result.push({ ...best, logoUrl });
      continue;
    }

    for (const region of regions) {
      const regional = group.find((link) => link.region === region);
      result.push({
        ...best,
        region,
        logoUrl,
        // La monétisation est propre au pays (abonnement ici, achat ailleurs).
        monetization: regional?.monetization ?? best.monetization,
        language: regional?.language ?? best.language,
      });
    }
  }

  return result;
}

function score(link: OfficialLink): number {
  const confidence = link.confidence === 'exact' ? 6 : link.confidence === 'search' ? 3 : 1;
  return confidence + (link.official ? 2 : 0) + (link.source === 'registry' ? 0 : 1);
}

/**
 * Ordre d'affichage. La question à laquelle il répond est « où puis-je
 * consommer cette œuvre, maintenant, dans ma langue ? » — d'où le classement :
 * sources personnelles, puis lecture ou visionnage avant l'achat, plateformes
 * possédées en tête, langue préférée, gratuit avant payant, et enfin les liens
 * directs avant les recherches.
 */
function compare(options: ResolveOptions) {
  const owned = new Set(options.ownedPlatforms ?? []);
  const languages = options.languages;

  const rank = (link: OfficialLink): number[] => [
    link.platform.startsWith('custom:') ? 0 : 1,
    link.kind === 'info' ? 3 : link.kind === 'buy' ? 2 : 0,
    owned.has(link.platform) ? 0 : 1,
    languageRank(link, languages),
    { free: 0, ads: 1, sub: 2, rent: 3, buy: 4, unknown: 5 }[link.monetization],
    link.confidence === 'exact' ? 0 : link.confidence === 'search' ? 1 : 2,
  ];

  return (a: OfficialLink, b: OfficialLink): number => {
    const left = rank(a);
    const right = rank(b);
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return (left[i] ?? 0) - (right[i] ?? 0);
    }
    return a.platformLabel.localeCompare(b.platformLabel);
  };
}

function languageRank(link: OfficialLink, languages: string[]): number {
  if (!link.language) return languages.length;
  const index = languages.indexOf(link.language);
  return index === -1 ? languages.length : index;
}
