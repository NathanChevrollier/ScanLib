import { OfficialLinkResolver, ProviderRegistry } from '@scanlib/providers';
import { config } from '../config.js';
import { cache } from '../db/cache.js';
import { logger } from './logger.js';

/**
 * Registre unique pour tout le processus : les files d'attente de limitation
 * de débit sont partagées, donc instancier deux registres reviendrait à
 * doubler le trafic vers les API publiques.
 */
export const registry = new ProviderRegistry({
  userAgent: config.PROVIDER_USER_AGENT,
  tmdbApiKey: config.TMDB_API_KEY,
  enableAnilist: config.ENABLE_ANILIST,
  languages: config.DEFAULT_LANGUAGES,
  regions: config.DEFAULT_WATCH_REGIONS,
  cache,
  logger,
});

export const linkResolver = new OfficialLinkResolver(registry, logger);
