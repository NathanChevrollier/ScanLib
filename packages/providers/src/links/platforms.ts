import type { LinkKind, Monetization, WorkKind } from '@scanlib/shared';

/**
 * Registre des plateformes légales connues.
 *
 * Il sert à trois choses :
 *  1. normaliser les noms renvoyés par TMDB (« Crunchyroll », « Netflix ») et
 *     par Jikan vers un identifiant stable ;
 *  2. reconnaître une plateforme à partir d'une URL (liens `engtl` / `raw` de
 *     MangaDex, qui ne donnent que l'adresse) ;
 *  3. fabriquer un lien quand aucune API ne fournit d'adresse directe.
 *
 * **Une plateforme n'est proposée que si sa recherche a été vérifiée**, c'est-à-dire
 * si sa page de résultats contient réellement le titre demandé (`npm run
 * links:verify`). Les services entièrement en JavaScript derrière un pare-feu
 * applicatif — ADN, Mangas.io, Disney+, Glénat… — n'exposent aucune URL de
 * recherche exploitable : ils restent déclarés ici pour être *reconnus* quand
 * une API y renvoie, mais ne sont jamais suggérés. Mieux vaut proposer trois
 * liens sûrs que dix dont la moitié tombe à côté.
 *
 * C'est volontairement le seul endroit du code où vivent des URLs en dur.
 * Chaque utilisateur peut par ailleurs ajouter ses propres sources depuis les
 * Réglages, sans toucher à ce fichier.
 */
export interface Platform {
  id: string;
  label: string;
  kind: LinkKind;
  monetization: Monetization;
  /** Langues de contenu proposées par la plateforme. */
  languages: string[];
  /** Pays où la plateforme est pertinente. Vide = international. */
  regions: string[];
  official: boolean;
  homepage: string;
  worksFor: WorkKind[];
  /** Noms alternatifs rencontrés dans TMDB, Jikan et MangaDex. */
  aliases: string[];
  /** Domaines permettant de reconnaître un lien existant. */
  hosts: string[];
  /**
   * URL de recherche **vérifiée**. Son absence est volontaire : la plateforme
   * est alors reconnue mais jamais suggérée, faute d'adresse fiable.
   */
  search?: (title: string) => string;
  /**
   * Ordre d'affichage à conditions égales : 0 pour les plateformes où l'on
   * consomme l'œuvre (streaming, lecture en ligne), 10 pour les librairies.
   */
  priority: number;
}

const q = (title: string): string => encodeURIComponent(title);

export const PLATFORMS: Platform[] = [
  /* --- Streaming animés ------------------------------------------------- */
  {
    id: 'crunchyroll',
    label: 'Crunchyroll',
    kind: 'stream',
    monetization: 'sub',
    languages: ['fr', 'en', 'ja'],
    regions: ['FR', 'US', 'GB', 'BE', 'CH', 'CA'],
    official: true,
    homepage: 'https://www.crunchyroll.com',
    worksFor: ['anime'],
    aliases: ['crunchyroll', 'crunchyroll amazon channel', 'vrv', 'funimation', 'wakanim'],
    hosts: ['crunchyroll.com', 'wakanim.tv', 'funimation.com'],
    search: (title) => `https://www.crunchyroll.com/search?q=${q(title)}`,
    priority: 0,
  },
  {
    id: 'adn',
    label: 'Animation Digital Network',
    kind: 'stream',
    monetization: 'sub',
    languages: ['fr', 'ja'],
    regions: ['FR', 'BE', 'CH'],
    official: true,
    homepage: 'https://animationdigitalnetwork.com',
    worksFor: ['anime'],
    aliases: ['animation digital network', 'adn', 'anime digital network'],
    hosts: ['animationdigitalnetwork.fr', 'animationdigitalnetwork.com', 'animedigitalnetwork.fr'],
    // Application JavaScript : toutes les routes de recherche testées répondent
    // 404 hors navigateur. Reconnue quand TMDB ou Jikan y renvoie, jamais suggérée.
    priority: 0,
  },
  {
    id: 'netflix',
    label: 'Netflix',
    kind: 'stream',
    monetization: 'sub',
    languages: ['fr', 'en'],
    regions: [],
    official: true,
    homepage: 'https://www.netflix.com',
    worksFor: ['anime', 'tv', 'movie'],
    aliases: ['netflix', 'netflix basic with ads', 'netflix standard with ads'],
    hosts: ['netflix.com'],
    // Recherche inaccessible sans session : impossible de garantir la page
    // d'arrivée. TMDB fournit de toute façon un lien exact quand le titre y est.
    priority: 1,
  },
  {
    id: 'prime-video',
    label: 'Prime Video',
    kind: 'stream',
    monetization: 'sub',
    languages: ['fr', 'en'],
    regions: [],
    official: true,
    homepage: 'https://www.primevideo.com',
    worksFor: ['anime', 'tv', 'movie'],
    aliases: ['amazon prime video', 'prime video', 'amazon video'],
    hosts: ['primevideo.com', 'amazon.com/gp/video', 'amazon.fr/gp/video'],
    search: (title) => `https://www.primevideo.com/search/ref=atv_sr_sug?phrase=${q(title)}`,
    priority: 1,
  },
  {
    id: 'disney-plus',
    label: 'Disney+',
    kind: 'stream',
    monetization: 'sub',
    languages: ['fr', 'en'],
    regions: [],
    official: true,
    homepage: 'https://www.disneyplus.com',
    worksFor: ['anime', 'tv', 'movie'],
    aliases: ['disney plus', 'disney+', 'star plus'],
    hosts: ['disneyplus.com'],
    priority: 2,
  },
  {
    id: 'max',
    label: 'Max',
    kind: 'stream',
    monetization: 'sub',
    languages: ['en', 'fr'],
    regions: [],
    official: true,
    homepage: 'https://play.max.com',
    worksFor: ['tv', 'movie', 'anime'],
    aliases: ['max', 'hbo max'],
    hosts: ['max.com', 'hbomax.com'],
    // Recherche non confirmee (rendu JavaScript ou anti-robot) : non suggeree.
    priority: 2,
  },
  {
    id: 'apple-tv',
    label: 'Apple TV',
    kind: 'stream',
    monetization: 'sub',
    languages: ['fr', 'en'],
    regions: [],
    official: true,
    homepage: 'https://tv.apple.com',
    worksFor: ['tv', 'movie', 'anime'],
    aliases: ['apple tv plus', 'apple tv+', 'apple tv'],
    hosts: ['tv.apple.com'],
    search: (title) => `https://tv.apple.com/search?term=${q(title)}`,
    priority: 2,
  },
  {
    id: 'paramount-plus',
    label: 'Paramount+',
    kind: 'stream',
    monetization: 'sub',
    languages: ['fr', 'en'],
    regions: [],
    official: true,
    homepage: 'https://www.paramountplus.com',
    worksFor: ['tv', 'movie'],
    aliases: ['paramount plus', 'paramount+'],
    hosts: ['paramountplus.com'],
    // Recherche non confirmee (rendu JavaScript ou anti-robot) : non suggeree.
    priority: 3,
  },
  {
    id: 'canal-plus',
    label: 'Canal+',
    kind: 'stream',
    monetization: 'sub',
    languages: ['fr'],
    regions: ['FR'],
    official: true,
    homepage: 'https://www.canalplus.com',
    worksFor: ['tv', 'movie'],
    aliases: ['canal+', 'canal plus', 'mycanal'],
    hosts: ['canalplus.com'],
    priority: 3,
  },
  {
    id: 'arte',
    label: 'arte.tv',
    kind: 'stream',
    monetization: 'free',
    languages: ['fr'],
    regions: ['FR', 'BE', 'CH'],
    official: true,
    homepage: 'https://www.arte.tv',
    worksFor: ['tv', 'movie', 'anime'],
    aliases: ['arte', 'arte.tv'],
    hosts: ['arte.tv'],
    search: (title) => `https://www.arte.tv/fr/search/?q=${q(title)}`,
    priority: 0,
  },
  {
    id: 'france-tv',
    label: 'france.tv',
    kind: 'stream',
    monetization: 'free',
    languages: ['fr'],
    regions: ['FR'],
    official: true,
    homepage: 'https://www.france.tv',
    worksFor: ['tv', 'movie', 'anime'],
    aliases: ['france tv', 'france.tv', 'france televisions'],
    hosts: ['france.tv'],
    // Recherche non confirmee (rendu JavaScript ou anti-robot) : non suggeree.
    priority: 0,
  },
  {
    id: 'hulu',
    label: 'Hulu',
    kind: 'stream',
    monetization: 'sub',
    languages: ['en'],
    regions: ['US'],
    official: true,
    homepage: 'https://www.hulu.com',
    worksFor: ['tv', 'movie', 'anime'],
    aliases: ['hulu'],
    hosts: ['hulu.com'],
    // Recherche non confirmee (rendu JavaScript ou anti-robot) : non suggeree.
    priority: 3,
  },
  {
    id: 'youtube',
    label: 'YouTube',
    kind: 'stream',
    monetization: 'free',
    languages: ['en', 'ja', 'fr'],
    regions: [],
    official: true,
    homepage: 'https://www.youtube.com',
    worksFor: ['anime', 'tv', 'movie'],
    aliases: ['youtube', 'youtube free', 'youtube premium'],
    hosts: ['youtube.com', 'youtu.be'],
    search: (title) => `https://www.youtube.com/results?search_query=${q(title)}`,
    priority: 6,
  },

  /* --- Lecture en ligne : webtoons et scans ----------------------------- */
  {
    id: 'webtoon',
    label: 'WEBTOON',
    kind: 'read',
    monetization: 'free',
    languages: ['fr', 'en'],
    regions: [],
    official: true,
    homepage: 'https://www.webtoons.com',
    worksFor: ['manga'],
    aliases: ['webtoon', 'webtoons', 'line webtoon', 'naver webtoon'],
    hosts: ['webtoons.com', 'webtoon.com'],
    search: (title) => `https://www.webtoons.com/fr/search?keyword=${q(title)}`,
    priority: 0,
  },
  {
    id: 'webtoon-en',
    label: 'WEBTOON (anglais)',
    kind: 'read',
    monetization: 'free',
    languages: ['en'],
    regions: ['US', 'GB'],
    official: true,
    homepage: 'https://www.webtoons.com/en',
    worksFor: ['manga'],
    aliases: [],
    hosts: [],
    search: (title) => `https://www.webtoons.com/en/search?keyword=${q(title)}`,
    priority: 1,
  },
  {
    id: 'mangaplus',
    label: 'MANGA Plus by SHUEISHA',
    kind: 'read',
    monetization: 'free',
    languages: ['en', 'fr', 'es'],
    regions: [],
    official: true,
    homepage: 'https://mangaplus.shueisha.co.jp',
    worksFor: ['manga'],
    aliases: ['manga plus', 'mangaplus', 'manga plus by shueisha'],
    hosts: ['mangaplus.shueisha.co.jp'],
    priority: 0,
  },
  {
    id: 'tapas',
    label: 'Tapas',
    kind: 'read',
    monetization: 'free',
    languages: ['en'],
    regions: ['US', 'GB'],
    official: true,
    homepage: 'https://tapas.io',
    worksFor: ['manga'],
    aliases: ['tapas', 'tapas.io', 'tapastic'],
    hosts: ['tapas.io'],
    search: (title) => `https://tapas.io/search?q=${q(title)}`,
    priority: 1,
  },
  {
    id: 'delitoon',
    label: 'Delitoon',
    kind: 'read',
    monetization: 'free',
    languages: ['fr'],
    regions: ['FR'],
    official: true,
    homepage: 'https://www.delitoon.com',
    worksFor: ['manga'],
    aliases: ['delitoon'],
    hosts: ['delitoon.com'],
    search: (title) => `https://www.delitoon.com/search?keyword=${q(title)}`,
    priority: 0,
  },
  {
    id: 'mangas-io',
    label: 'Mangas.io',
    kind: 'read',
    monetization: 'sub',
    languages: ['fr'],
    regions: ['FR'],
    official: true,
    homepage: 'https://www.mangas.io',
    worksFor: ['manga'],
    aliases: ['mangas.io', 'mangas io'],
    hosts: ['mangas.io'],
    priority: 0,
  },
  {
    id: 'izneo',
    label: 'izneo',
    kind: 'read',
    monetization: 'sub',
    languages: ['fr'],
    regions: ['FR', 'BE'],
    official: true,
    homepage: 'https://www.izneo.com',
    worksFor: ['manga'],
    aliases: ['izneo'],
    hosts: ['izneo.com'],
    search: (title) => `https://www.izneo.com/fr/recherche/${q(title)}`,
    priority: 1,
  },
  {
    id: 'viz',
    label: 'VIZ Media',
    kind: 'read',
    monetization: 'sub',
    languages: ['en'],
    regions: ['US'],
    official: true,
    homepage: 'https://www.viz.com',
    worksFor: ['manga'],
    aliases: ['viz', 'viz media', 'shonen jump'],
    hosts: ['viz.com'],
    search: (title) => `https://www.viz.com/search?search=${q(title)}`,
    priority: 1,
  },
  {
    id: 'azuki',
    label: 'Azuki',
    kind: 'read',
    monetization: 'sub',
    languages: ['en'],
    regions: ['US'],
    official: true,
    homepage: 'https://www.azuki.co',
    worksFor: ['manga'],
    aliases: ['azuki'],
    hosts: ['azuki.co'],
    search: (title) => `https://www.azuki.co/search?q=${q(title)}`,
    priority: 2,
  },
  {
    id: 'manta',
    label: 'Manta',
    kind: 'read',
    monetization: 'sub',
    languages: ['en'],
    regions: ['US', 'GB'],
    official: true,
    homepage: 'https://manta.net',
    worksFor: ['manga'],
    aliases: ['manta', 'manta comics'],
    hosts: ['manta.net'],
    search: (title) => `https://manta.net/en/search?keyword=${q(title)}`,
    priority: 2,
  },
  {
    id: 'comikey',
    label: 'Comikey',
    kind: 'read',
    monetization: 'free',
    languages: ['en'],
    regions: [],
    official: true,
    homepage: 'https://comikey.com',
    worksFor: ['manga'],
    aliases: ['comikey'],
    hosts: ['comikey.com'],
    search: (title) => `https://comikey.com/comics/?q=${q(title)}`,
    priority: 2,
  },
  {
    id: 'inkr',
    label: 'INKR',
    kind: 'read',
    monetization: 'free',
    languages: ['en'],
    regions: [],
    official: true,
    homepage: 'https://comics.inkr.com',
    worksFor: ['manga'],
    aliases: ['inkr', 'inkr comics'],
    hosts: ['inkr.com'],
    // Recherche non confirmee (rendu JavaScript ou anti-robot) : non suggeree.
    priority: 3,
  },
  {
    id: 'bilibili-comics',
    label: 'Bilibili Comics',
    kind: 'read',
    monetization: 'free',
    languages: ['en'],
    regions: [],
    official: true,
    homepage: 'https://www.bilibilicomics.com',
    worksFor: ['manga'],
    aliases: ['bilibili comics', 'bilibilicomics'],
    hosts: ['bilibilicomics.com'],
    // Reconnu quand MangaDex y renvoie, mais pas proposé spontanément :
    // le site est inaccessible depuis l'Europe.
    priority: 5,
  },
  {
    id: 'shonenjumpplus',
    label: 'Shonen Jump+ (VO)',
    kind: 'read',
    monetization: 'free',
    languages: ['ja'],
    regions: ['JP'],
    official: true,
    homepage: 'https://shonenjumpplus.com',
    worksFor: ['manga'],
    aliases: ['shonen jump+', 'shonen jump plus', 'jump plus'],
    hosts: ['shonenjumpplus.com', 'tonarinoyj.jp', 'comic-days.com', 'comic-walker.com'],
    priority: 4,
  },

  /* --- Achat et édition ------------------------------------------------- */
  {
    id: 'bubble',
    label: 'Bubble',
    kind: 'buy',
    monetization: 'buy',
    languages: ['fr'],
    regions: ['FR'],
    official: true,
    homepage: 'https://www.bubblebd.com',
    worksFor: ['manga'],
    aliases: ['bubble', 'bubble bd'],
    hosts: ['bubblebd.com'],
    search: (title) => `https://www.bubblebd.com/search?q=${q(title)}`,
    priority: 10,
  },
  {
    id: 'cultura',
    label: 'Cultura',
    kind: 'buy',
    monetization: 'buy',
    languages: ['fr'],
    regions: ['FR'],
    official: true,
    homepage: 'https://www.cultura.com',
    worksFor: ['manga'],
    aliases: ['cultura'],
    hosts: ['cultura.com'],
    search: (title) => `https://www.cultura.com/search/results?search_query=${q(title)}`,
    priority: 11,
  },
  {
    id: 'fnac',
    label: 'Fnac',
    kind: 'buy',
    monetization: 'buy',
    languages: ['fr'],
    regions: ['FR'],
    official: true,
    homepage: 'https://www.fnac.com',
    worksFor: ['manga'],
    aliases: ['fnac'],
    hosts: ['fnac.com'],
    // Recherche non confirmee (rendu JavaScript ou anti-robot) : non suggeree.
    priority: 11,
  },
  {
    id: 'amazon-fr',
    label: 'Amazon.fr',
    kind: 'buy',
    monetization: 'buy',
    languages: ['fr'],
    regions: ['FR'],
    official: true,
    homepage: 'https://www.amazon.fr',
    worksFor: ['manga'],
    aliases: ['amazon.fr'],
    hosts: ['amazon.fr'],
    // Recherche non confirmee (rendu JavaScript ou anti-robot) : non suggeree.
    priority: 12,
  },
  {
    id: 'amazon',
    label: 'Amazon',
    kind: 'buy',
    monetization: 'buy',
    languages: ['en', 'ja'],
    regions: ['US', 'JP'],
    official: true,
    homepage: 'https://www.amazon.com',
    worksFor: ['manga'],
    aliases: ['amazon', 'amazon kindle', 'kindle'],
    hosts: ['amazon.com', 'amazon.co.jp', 'amzn.to'],
    search: (title) => `https://www.amazon.com/s?k=${q(title)}&i=stripbooks`,
    priority: 13,
  },
  {
    id: 'kana',
    label: 'Kana',
    kind: 'buy',
    monetization: 'buy',
    languages: ['fr'],
    regions: ['FR'],
    official: true,
    homepage: 'https://www.kana.fr',
    worksFor: ['manga'],
    aliases: ['kana'],
    hosts: ['kana.fr'],
    search: (title) => `https://www.kana.fr/?s=${q(title)}`,
    priority: 12,
  },
  {
    id: 'ki-oon',
    label: 'Ki-oon',
    kind: 'buy',
    monetization: 'buy',
    languages: ['fr'],
    regions: ['FR'],
    official: true,
    homepage: 'https://ki-oon.com',
    worksFor: ['manga'],
    aliases: ['ki-oon', 'ki oon'],
    hosts: ['ki-oon.com'],
    search: (title) => `https://ki-oon.com/?s=${q(title)}&post_type=product`,
    priority: 12,
  },
  {
    id: 'glenat',
    label: 'Glénat',
    kind: 'buy',
    monetization: 'buy',
    languages: ['fr'],
    regions: ['FR'],
    official: true,
    homepage: 'https://www.glenat.com',
    worksFor: ['manga'],
    aliases: ['glenat', 'glénat'],
    hosts: ['glenat.com'],
    priority: 12,
  },
  {
    id: 'pika',
    label: 'Pika Édition',
    kind: 'buy',
    monetization: 'buy',
    languages: ['fr'],
    regions: ['FR'],
    official: true,
    homepage: 'https://www.pika.fr',
    worksFor: ['manga'],
    aliases: ['pika', 'pika edition'],
    hosts: ['pika.fr'],
    priority: 13,
  },
  {
    id: 'kodansha',
    label: 'Kodansha (US)',
    kind: 'buy',
    monetization: 'buy',
    languages: ['en'],
    regions: ['US'],
    official: true,
    homepage: 'https://kodansha.us',
    worksFor: ['manga'],
    aliases: ['kodansha', 'kodansha comics'],
    hosts: ['kodansha.us', 'kodanshacomics.com'],
    search: (title) => `https://kodansha.us/search/?q=${q(title)}`,
    priority: 13,
  },
  {
    id: 'yenpress',
    label: 'Yen Press',
    kind: 'buy',
    monetization: 'buy',
    languages: ['en'],
    regions: ['US'],
    official: true,
    homepage: 'https://yenpress.com',
    worksFor: ['manga'],
    aliases: ['yen press', 'yenpress'],
    hosts: ['yenpress.com'],
    search: (title) => `https://yenpress.com/search?q=${q(title)}`,
    priority: 13,
  },
  {
    id: 'bookwalker',
    label: 'BOOK☆WALKER',
    kind: 'buy',
    monetization: 'buy',
    languages: ['ja', 'en'],
    regions: ['JP'],
    official: true,
    homepage: 'https://bookwalker.jp',
    worksFor: ['manga'],
    aliases: ['bookwalker', 'book walker'],
    hosts: ['bookwalker.jp', 'global.bookwalker.jp'],
    // Recherche non confirmee (rendu JavaScript ou anti-robot) : non suggeree.
    priority: 14,
  },
  {
    id: 'ebookjapan',
    label: 'ebookjapan',
    kind: 'buy',
    monetization: 'buy',
    languages: ['ja'],
    regions: ['JP'],
    official: true,
    homepage: 'https://ebookjapan.yahoo.co.jp',
    worksFor: ['manga'],
    aliases: ['ebookjapan', 'ebook japan'],
    hosts: ['ebookjapan.yahoo.co.jp', 'ebookjapan.jp'],
    priority: 15,
  },
  {
    id: 'cdjapan',
    label: 'CDJapan',
    kind: 'buy',
    monetization: 'buy',
    languages: ['ja'],
    regions: ['JP'],
    official: true,
    homepage: 'https://www.cdjapan.co.jp',
    worksFor: ['manga'],
    aliases: ['cdjapan'],
    hosts: ['cdjapan.co.jp'],
    priority: 15,
  },

  /* --- Bases de données (informatif) ------------------------------------ */
  {
    id: 'mangadex',
    label: 'MangaDex',
    kind: 'info',
    monetization: 'free',
    languages: ['en', 'fr'],
    regions: [],
    official: false,
    homepage: 'https://mangadex.org',
    worksFor: ['manga'],
    aliases: ['mangadex'],
    hosts: ['mangadex.org'],
    priority: 20,
  },
  {
    id: 'myanimelist',
    label: 'MyAnimeList',
    kind: 'info',
    monetization: 'free',
    languages: ['en'],
    regions: [],
    official: false,
    homepage: 'https://myanimelist.net',
    worksFor: ['manga', 'anime'],
    aliases: ['myanimelist', 'mal'],
    hosts: ['myanimelist.net'],
    priority: 20,
  },
  {
    id: 'anilist',
    label: 'AniList',
    kind: 'info',
    monetization: 'free',
    languages: ['en'],
    regions: [],
    official: false,
    homepage: 'https://anilist.co',
    worksFor: ['manga', 'anime'],
    aliases: ['anilist'],
    hosts: ['anilist.co'],
    priority: 20,
  },
  {
    id: 'nautiljon',
    label: 'Nautiljon',
    kind: 'info',
    monetization: 'free',
    languages: ['fr'],
    regions: ['FR'],
    official: false,
    homepage: 'https://www.nautiljon.com',
    worksFor: ['manga', 'anime'],
    aliases: ['nautiljon'],
    hosts: ['nautiljon.com'],
    priority: 20,
  },
  {
    id: 'tmdb',
    label: 'TMDB',
    kind: 'info',
    monetization: 'free',
    languages: ['fr', 'en'],
    regions: [],
    official: false,
    homepage: 'https://www.themoviedb.org',
    worksFor: ['tv', 'movie', 'anime'],
    aliases: ['tmdb', 'the movie database', 'justwatch'],
    hosts: ['themoviedb.org', 'justwatch.com'],
    priority: 20,
  },
];

const byId = new Map(PLATFORMS.map((platform) => [platform.id, platform]));

const byAlias = new Map<string, Platform>();
for (const platform of PLATFORMS) {
  byAlias.set(normalize(platform.label), platform);
  byAlias.set(normalize(platform.id), platform);
  for (const alias of platform.aliases) byAlias.set(normalize(alias), platform);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+]+/g, ' ')
    .trim();
}

export function getPlatform(id: string): Platform | undefined {
  return byId.get(id);
}

/** Reconnaît une plateforme depuis un nom (TMDB, Jikan, MangaDex). */
export function resolvePlatform(name: string): Platform | undefined {
  const key = normalize(name);
  const exact = byAlias.get(key);
  if (exact) return exact;
  // TMDB suffixe fréquemment ses libellés : « Crunchyroll Amazon Channel ».
  for (const [alias, platform] of byAlias) {
    if (alias.length >= 4 && key.startsWith(alias)) return platform;
  }
  return undefined;
}

/** Reconnaît une plateforme depuis une URL (liens `engtl` / `raw` MangaDex). */
export function resolvePlatformByUrl(url: string): Platform | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
  return PLATFORMS.find((platform) =>
    platform.hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`)),
  );
}

/**
 * Plateformes à proposer pour une œuvre, filtrées par famille, langue et
 * région. Ce sont les liens de secours quand aucune API ne fournit d'URL
 * directe — typiquement tout le catalogue français.
 */
export function suggestedPlatforms(
  kind: WorkKind,
  languages: string[],
  regions: string[],
): Platform[] {
  return PLATFORMS.filter((platform) => {
    if (platform.kind === 'info') return false;
    // Pas d'URL de recherche vérifiée : la plateforme n'est pas proposée.
    if (!platform.search) return false;
    if (!platform.worksFor.includes(kind)) return false;
    if (languages.length > 0 && !platform.languages.some((lang) => languages.includes(lang))) {
      return false;
    }
    if (
      regions.length > 0 &&
      platform.regions.length > 0 &&
      !platform.regions.some((region) => regions.includes(region))
    ) {
      return false;
    }
    return true;
  }).sort((a, b) => a.priority - b.priority);
}

/** URL de recherche à ouvrir pour une plateforme, si elle en expose une. */
export function platformUrl(
  platform: Platform,
  title: string,
): { url: string; confidence: 'search' } | null {
  if (!platform.search) return null;
  return { url: platform.search(title), confidence: 'search' };
}
