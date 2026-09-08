/**
 * Plateformes proposées dans les réglages « Mes abonnements ».
 *
 * Le registre complet vit côté serveur
 * (`packages/providers/src/links/platforms.ts`) ; le front n'a besoin que des
 * services auxquels on s'abonne, pour les remonter en tête des liens.
 */
export const PLATFORM_OPTIONS: { value: string; label: string }[] = [
  // Visionnage
  { value: 'crunchyroll', label: 'Crunchyroll' },
  { value: 'adn', label: 'ADN' },
  { value: 'netflix', label: 'Netflix' },
  { value: 'disney-plus', label: 'Disney+' },
  { value: 'prime-video', label: 'Prime Video' },
  { value: 'max', label: 'Max' },
  { value: 'apple-tv', label: 'Apple TV' },
  { value: 'canal-plus', label: 'Canal+' },
  { value: 'paramount-plus', label: 'Paramount+' },
  { value: 'arte', label: 'arte.tv' },
  { value: 'france-tv', label: 'france.tv' },
  // Lecture
  { value: 'webtoon', label: 'WEBTOON' },
  { value: 'mangaplus', label: 'MANGA Plus' },
  { value: 'tapas', label: 'Tapas' },
  { value: 'delitoon', label: 'Delitoon' },
  { value: 'mangas-io', label: 'Mangas.io' },
  { value: 'izneo', label: 'izneo' },
  { value: 'viz', label: 'VIZ' },
  { value: 'azuki', label: 'Azuki' },
  { value: 'manta', label: 'Manta' },
  { value: 'comikey', label: 'Comikey' },
  { value: 'inkr', label: 'INKR' },
];
