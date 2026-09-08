import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type {
  ExternalRef,
  OfficialLink,
  ProviderId,
  Unit,
  UserPreferences,
  WorkDetails,
  WorkKind,
  WorkSummary,
} from '@scanlib/shared';
import { isSameWork } from '@scanlib/shared';
import type { ProviderUnit, ProviderWork, ProviderWorkDetails } from '@scanlib/providers';
import { db } from '../db/client.js';
import { externalIds, officialLinks, units, works, type WorkRow } from '../db/schema.js';
import { linkResolver, registry } from '../lib/providers.js';
import { logger } from '../lib/logger.js';
import { notFound } from '../lib/errors.js';
import { PROVIDER_PRIORITY } from '@scanlib/providers';

/* -------------------------------------------------------------------------
 * Conversions base ↔ contrat API
 * ---------------------------------------------------------------------- */

export function toSummary(row: WorkRow, externals: ExternalRef[] = []): WorkSummary {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    titles: row.titles,
    coverUrl: row.coverUrl,
    year: row.year,
    releaseStatus: row.releaseStatus,
    score: row.score,
    totalUnits: row.totalUnits,
    externals,
  };
}

export function toDetails(row: WorkRow, externals: ExternalRef[]): WorkDetails {
  return {
    ...toSummary(row, externals),
    synopsis: row.synopsis,
    genres: row.genres,
    bannerUrl: row.bannerUrl,
    averageRuntime: row.averageRuntime,
    startDate: row.startDate?.toISOString() ?? null,
    endDate: row.endDate?.toISOString() ?? null,
    studios: row.studios,
    authors: row.authors,
    availableLanguages: row.availableLanguages,
    nextRelease:
      row.nextReleaseAt && row.nextReleaseNumber != null
        ? { number: row.nextReleaseNumber, airingAt: row.nextReleaseAt.toISOString() }
        : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function externalsOf(workId: string): Promise<ExternalRef[]> {
  const rows = await db
    .select({ provider: externalIds.provider, providerId: externalIds.providerId, url: externalIds.url })
    .from(externalIds)
    .where(eq(externalIds.workId, workId));
  return rows;
}

export async function getWork(workId: string): Promise<WorkRow> {
  const [row] = await db.select().from(works).where(eq(works.id, workId)).limit(1);
  if (!row) throw notFound('Œuvre');
  return row;
}

/* -------------------------------------------------------------------------
 * Création et rapprochement des œuvres
 * ---------------------------------------------------------------------- */

/**
 * Retourne l'œuvre correspondant à une référence externe, en la créant au
 * besoin depuis le provider concerné.
 *
 * Le rapprochement se fait d'abord par identifiant croisé (MangaDex publie les
 * IDs MyAnimeList, AniList et Kitsu de chaque série ; TMDB ses `external_ids`),
 * puis, faute de mieux, par similarité de titre et d'année.
 */
export async function ensureWork(ref: {
  provider: ProviderId;
  providerId: string;
  kind: WorkKind;
}): Promise<WorkRow> {
  const existing = await findByExternal(ref.provider, ref.providerId);
  if (existing) return existing;

  const provider = registry.get(ref.provider);
  if (!provider?.enabled) throw notFound(`Source ${ref.provider}`);

  const details = await provider.details(ref.providerId, ref.kind);
  if (!details) throw notFound('Œuvre');

  // Un identifiant croisé rattache parfois la fiche à une œuvre déjà connue.
  for (const external of details.externals) {
    const match = await findByExternal(external.provider, external.providerId);
    if (match) {
      await attachExternals(match.id, [
        ...details.externals,
        { provider: ref.provider, providerId: ref.providerId },
      ]);
      return match;
    }
  }

  const fuzzy = await findSimilar(details);
  if (fuzzy) {
    await attachExternals(fuzzy.id, [
      ...details.externals,
      { provider: ref.provider, providerId: ref.providerId },
    ]);
    return fuzzy;
  }

  const created = await insertWork(details);
  await attachExternals(created.id, [
    ...details.externals,
    { provider: ref.provider, providerId: ref.providerId },
  ]);

  // Les sources secondaires (titre français, note, jaquette) sont récupérées
  // en arrière-plan : l'ajout à la bibliothèque ne doit pas attendre.
  void enrich(created.id, details).catch((error: unknown) => {
    logger.warn('enrichissement impossible', {
      workId: created.id,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return created;
}

async function findByExternal(provider: ProviderId, providerId: string): Promise<WorkRow | null> {
  const [row] = await db
    .select({ work: works })
    .from(externalIds)
    .innerJoin(works, eq(works.id, externalIds.workId))
    .where(and(eq(externalIds.provider, provider), eq(externalIds.providerId, providerId)))
    .limit(1);
  return row?.work ?? null;
}

/** Repli sur la similarité de titre, restreint à la même famille et à ±1 an. */
async function findSimilar(candidate: ProviderWorkDetails): Promise<WorkRow | null> {
  const rows = await db
    .select()
    .from(works)
    .where(
      candidate.year == null
        ? eq(works.kind, candidate.kind)
        : and(
            eq(works.kind, candidate.kind),
            sql`${works.year} between ${candidate.year - 1} and ${candidate.year + 1}`,
          ),
    )
    .limit(200);

  return (
    rows.find((row) =>
      isSameWork(
        { kind: row.kind, titles: row.titles, year: row.year },
        { kind: candidate.kind, titles: candidate.titles, year: candidate.year },
      ),
    ) ?? null
  );
}

async function insertWork(details: ProviderWorkDetails): Promise<WorkRow> {
  const [row] = await db
    .insert(works)
    .values({
      kind: details.kind,
      title: details.title,
      titles: details.titles,
      synopsis: details.synopsis,
      coverUrl: details.coverUrl,
      bannerUrl: details.bannerUrl,
      year: details.year,
      releaseStatus: details.releaseStatus,
      score: details.score,
      totalUnits: details.totalUnits,
      genres: details.genres,
      studios: details.studios,
      authors: details.authors,
      availableLanguages: details.availableLanguages,
      averageRuntime: details.averageRuntime,
      startDate: details.startDate ? new Date(details.startDate) : null,
      endDate: details.endDate ? new Date(details.endDate) : null,
      nextReleaseNumber: details.nextRelease?.number ?? null,
      nextReleaseAt: details.nextRelease ? new Date(details.nextRelease.airingAt) : null,
      refreshedAt: new Date(),
    })
    .returning();
  return row!;
}

/**
 * Détache une source d'une œuvre. Utilisé pour défaire un rapprochement
 * automatique erroné — deux éditions fusionnées à tort, par exemple.
 */
export async function detachExternal(workId: string, provider: ProviderId): Promise<void> {
  await db
    .delete(externalIds)
    .where(and(eq(externalIds.workId, workId), eq(externalIds.provider, provider)));
}

export async function attachExternals(workId: string, refs: ExternalRef[]): Promise<void> {
  if (refs.length === 0) return;
  await db
    .insert(externalIds)
    .values(
      refs.map((ref) => ({
        workId,
        provider: ref.provider,
        providerId: ref.providerId,
        url: ref.url ?? null,
      })),
    )
    .onConflictDoNothing();
}

/**
 * Complète une fiche avec les autres sources : titre et résumé français (Kitsu,
 * TMDB), note (Jikan), jaquette de meilleure qualité. C'est ce qui permet
 * d'afficher « L'Attaque des Titans » plutôt que « Shingeki no Kyojin ».
 */
async function enrich(workId: string, details: ProviderWorkDetails): Promise<void> {
  const others = registry
    .for(details.kind)
    .filter((provider) => provider.id !== details.provider);
  if (others.length === 0) return;

  const patch: Partial<typeof works.$inferInsert> = {};
  const titles = { ...details.titles };
  const synopsis = { ...details.synopsis };
  const found: ExternalRef[] = [];

  for (const provider of others.slice(0, 2)) {
    try {
      const matches = await provider.search(details.title, { kinds: [details.kind], limit: 5 });
      const match = matches.find((candidate) =>
        isSameWork(
          { kind: candidate.kind, titles: candidate.titles, year: candidate.year },
          { kind: details.kind, titles: details.titles, year: details.year },
        ),
      );
      if (!match) continue;

      found.push({ provider: match.provider, providerId: match.providerId, url: null });
      for (const [lang, value] of Object.entries(match.titles)) {
        if (!titles[lang]) titles[lang] = value;
      }
      if (details.score == null && match.score != null) patch.score = match.score;
      if (!details.coverUrl && match.coverUrl) patch.coverUrl = match.coverUrl;

      const full = await provider.details(match.providerId, details.kind);
      for (const [lang, value] of Object.entries(full?.synopsis ?? {})) {
        if (!synopsis[lang]) synopsis[lang] = value;
      }
    } catch (error) {
      logger.debug('source secondaire indisponible', {
        provider: provider.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await attachExternals(workId, found);
  await db
    .update(works)
    .set({
      ...patch,
      titles,
      synopsis,
      title: titles.fr ?? details.title,
      updatedAt: new Date(),
    })
    .where(eq(works.id, workId));
}

/** Réactualise les métadonnées depuis la source prioritaire disponible. */
export async function refreshWork(workId: string): Promise<WorkRow> {
  const row = await getWork(workId);
  const refs = await externalsOf(workId);
  const ordered = orderRefs(refs, row.kind);

  for (const ref of ordered) {
    const provider = registry.get(ref.provider);
    if (!provider?.enabled) continue;
    try {
      const details = await provider.details(ref.providerId, row.kind);
      if (!details) continue;

      const [updated] = await db
        .update(works)
        .set({
          title: row.titles.fr ?? details.title,
          titles: { ...details.titles, ...row.titles },
          synopsis: { ...details.synopsis, ...row.synopsis },
          coverUrl: details.coverUrl ?? row.coverUrl,
          bannerUrl: details.bannerUrl ?? row.bannerUrl,
          releaseStatus: details.releaseStatus,
          score: details.score ?? row.score,
          totalUnits: details.totalUnits ?? row.totalUnits,
          genres: details.genres.length > 0 ? details.genres : row.genres,
          availableLanguages: details.availableLanguages,
          averageRuntime: details.averageRuntime ?? row.averageRuntime,
          endDate: details.endDate ? new Date(details.endDate) : row.endDate,
          nextReleaseNumber: details.nextRelease?.number ?? null,
          nextReleaseAt: details.nextRelease ? new Date(details.nextRelease.airingAt) : null,
          refreshedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(works.id, workId))
        .returning();
      return updated!;
    } catch (error) {
      logger.warn('rafraîchissement en échec', {
        workId,
        provider: ref.provider,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return row;
}

function orderRefs(refs: ExternalRef[], kind: WorkKind): ExternalRef[] {
  const priority = PROVIDER_PRIORITY[kind] ?? [];
  return [...refs].sort((a, b) => {
    const rank = (ref: ExternalRef) => {
      const index = priority.indexOf(ref.provider);
      return index === -1 ? priority.length : index;
    };
    return rank(a) - rank(b);
  });
}

/* -------------------------------------------------------------------------
 * Unités (chapitres / épisodes)
 * ---------------------------------------------------------------------- */

/** Clé stable de déduplication : `s1-e12`, `c1050`, ou repli sur le titre. */
export function dedupeKeyOf(unit: ProviderUnit): string {
  const prefix = unit.kind === 'chapter' ? 'c' : 'e';
  if (unit.number != null) {
    return unit.season != null && unit.kind === 'episode'
      ? `s${unit.season}-${prefix}${unit.number}`
      : `${prefix}${unit.number}`;
  }
  return `t:${(unit.title ?? 'sans-titre').toLowerCase().slice(0, 80)}`;
}

/**
 * Récupère les unités auprès de la première source capable de les fournir et
 * les insère sans écraser celles déjà connues. Renvoie le nombre de nouveautés,
 * ce qui alimente les notifications du job `detect-new-units`.
 */
export async function syncUnits(
  workId: string,
  options: { languages?: string[]; full?: boolean } = {},
): Promise<{ inserted: number; total: number }> {
  const row = await getWork(workId);
  const refs = orderRefs(await externalsOf(workId), row.kind);

  /*
   * Synchronisation incrémentale : si des unités sont déjà connues, on ne
   * demande à la source que ce qui a été publié depuis la plus récente. Le
   * repère recule d'un jour par prudence — les dates de publication sont
   * parfois corrigées après coup.
   */
  const since = options.full ? null : await latestPublishedAt(workId);

  let fetched: ProviderUnit[] = [];
  for (const ref of refs) {
    const provider = registry.get(ref.provider);
    if (!provider?.enabled || !provider.units) continue;
    try {
      const result = await provider.units(ref.providerId, row.kind, {
        ...(options.languages ? { languages: options.languages } : {}),
        ...(since ? { since } : {}),
      });
      if (result.length > 0) {
        fetched = result;
        break;
      }
    } catch (error) {
      logger.warn('récupération des unités en échec', {
        workId,
        provider: ref.provider,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (fetched.length === 0) {
    await db.update(works).set({ unitsRefreshedAt: new Date() }).where(eq(works.id, workId));
    return { inserted: 0, total: 0 };
  }

  const values = fetched.map((unit) => ({
    workId,
    kind: unit.kind,
    number: unit.number,
    season: unit.season,
    title: unit.title,
    language: unit.language,
    publishedAt: unit.publishedAt ? new Date(unit.publishedAt) : null,
    runtime: unit.runtime,
    externalUrl: unit.externalUrl,
    isOfficial: unit.isOfficial,
    source: unit.source,
    dedupeKey: dedupeKeyOf(unit),
  }));

  const inserted = await db
    .insert(units)
    .values(values)
    .onConflictDoUpdate({
      target: [units.workId, units.dedupeKey],
      set: {
        // Le titre et l'URL peuvent apparaître après coup (traduction publiée
        // plus tard) ; la date de publication, elle, ne bouge plus.
        title: sql`coalesce(excluded.title, ${units.title})`,
        externalUrl: sql`coalesce(excluded.external_url, ${units.externalUrl})`,
        isOfficial: sql`${units.isOfficial} or excluded.is_official`,
      },
    })
    .returning({ id: units.id, createdAt: units.createdAt });

  const total = await countUnits(workId);
  await db
    .update(works)
    .set({
      unitsRefreshedAt: new Date(),
      totalUnits: row.totalUnits ?? total,
    })
    .where(eq(works.id, workId));

  // `returning` renvoie aussi les lignes mises à jour : on ne compte comme
  // nouveautés que celles créées à l'instant.
  const threshold = Date.now() - 5000;
  return {
    inserted: inserted.filter((unit) => unit.createdAt.getTime() >= threshold).length,
    total,
  };
}

/**
 * Date de publication de l'unité la plus récente déjà connue, reculée d'un
 * jour : les sources corrigent parfois une date après coup, et rater un
 * chapitre coûte plus cher que de le revoir.
 */
async function latestPublishedAt(workId: string): Promise<Date | null> {
  const [row] = await db
    .select({ latest: sql<Date | null>`max(${units.publishedAt})` })
    .from(units)
    .where(eq(units.workId, workId));

  if (!row?.latest) return null;
  return new Date(new Date(row.latest).getTime() - 86_400_000);
}

export async function countUnits(workId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(units)
    .where(eq(units.workId, workId));
  return row?.count ?? 0;
}

export async function listUnits(workId: string): Promise<Unit[]> {
  const rows = await db
    .select()
    .from(units)
    .where(eq(units.workId, workId))
    .orderBy(asc(units.season), asc(units.number), asc(units.createdAt));

  return rows.map((row) => ({
    id: row.id,
    workId: row.workId,
    kind: row.kind,
    number: row.number,
    season: row.season,
    title: row.title,
    language: row.language,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    runtime: row.runtime,
    externalUrl: row.externalUrl,
    isOfficial: row.isOfficial,
    source: row.source as ProviderId,
  }));
}

/* -------------------------------------------------------------------------
 * Liens officiels
 * ---------------------------------------------------------------------- */

/**
 * Recalcule les liens officiels et les met en cache en base. Les résultats
 * étant identiques pour tous les utilisateurs d'une même instance, seul le tri
 * final dépend des préférences.
 */
export async function syncLinks(
  workId: string,
  preferences: Pick<UserPreferences, 'languages' | 'regions' | 'ownedPlatforms'>,
): Promise<OfficialLink[]> {
  const row = await getWork(workId);
  const refs = await externalsOf(workId);

  const { links } = await linkResolver.resolve(
    { kind: row.kind, title: row.title, titles: row.titles, externals: refs },
    {
      languages: preferences.languages,
      regions: preferences.regions,
      ownedPlatforms: preferences.ownedPlatforms,
      officialOnly: false,
    },
  );

  if (links.length > 0) {
    await db
      .insert(officialLinks)
      .values(
        links.map((link, index) => ({
          workId,
          platform: link.platform,
          platformLabel: link.platformLabel,
          kind: link.kind,
          url: link.url,
          language: link.language,
          region: link.region,
          monetization: link.monetization,
          confidence: link.confidence,
          official: link.official,
          source: link.source,
          logoUrl: link.logoUrl ?? null,
          rank: index,
          dedupeKey: `${link.platform}|${link.kind}|${link.region ?? '*'}`,
          checkedAt: new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: [officialLinks.workId, officialLinks.dedupeKey],
        set: {
          url: sql`excluded.url`,
          platformLabel: sql`excluded.platform_label`,
          confidence: sql`excluded.confidence`,
          monetization: sql`excluded.monetization`,
          language: sql`excluded.language`,
          logoUrl: sql`excluded.logo_url`,
          rank: sql`excluded.rank`,
          checkedAt: new Date(),
          brokenAt: null,
        },
      });
  }

  await db.update(works).set({ linksRefreshedAt: new Date() }).where(eq(works.id, workId));
  return links;
}

export async function listLinks(workId: string): Promise<OfficialLink[]> {
  const rows = await db
    .select()
    .from(officialLinks)
    .where(and(eq(officialLinks.workId, workId), sql`${officialLinks.brokenAt} is null`))
    .orderBy(asc(officialLinks.rank));

  return rows.map((row) => ({
    platform: row.platform,
    platformLabel: row.platformLabel,
    kind: row.kind,
    url: row.url,
    language: row.language,
    region: row.region,
    monetization: row.monetization as OfficialLink['monetization'],
    confidence: row.confidence,
    official: row.official,
    source: row.source as OfficialLink['source'],
    logoUrl: row.logoUrl,
  }));
}

/** Résumés de plusieurs œuvres en une requête (listes, calendrier, files). */
export async function summariesOf(workIds: string[]): Promise<Map<string, WorkSummary>> {
  if (workIds.length === 0) return new Map();
  const rows = await db.select().from(works).where(inArray(works.id, workIds));
  return new Map(rows.map((row) => [row.id, toSummary(row)]));
}

export function providerWorkToRef(work: ProviderWork): {
  provider: ProviderId;
  providerId: string;
  kind: WorkKind;
} {
  return { provider: work.provider, providerId: work.providerId, kind: work.kind };
}
