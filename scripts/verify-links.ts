/**
 * Vérifie que chaque URL de recherche du registre mène réellement à l'œuvre.
 *
 *   npm run links:verify
 *   npm run links:verify -- "Frieren"
 *
 * Une plateforme n'a le droit de figurer dans les suggestions que si sa page de
 * résultats contient bien le titre cherché. Les sites protégés contre les
 * robots répondent 403 à ce script alors qu'ils fonctionnent dans un
 * navigateur : ils sont signalés « à vérifier à la main » plutôt que
 * condamnés, mais tout ce qui répond 404 doit disparaître du registre.
 */
import { PLATFORMS, platformUrl } from '../packages/providers/src/links/platforms.js';

const TITLE = process.argv[2] ?? 'One Piece';
const NEEDLE = new RegExp(TITLE.replace(/[^\p{L}\p{N}]+/gu, '[^a-z0-9]*'), 'iu');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

type Verdict = 'ok' | 'bloque' | 'sans-resultat' | 'casse' | 'injoignable';

const results: { id: string; verdict: Verdict; detail: string }[] = [];

await Promise.all(
  PLATFORMS.map(async (platform) => {
    const target = platformUrl(platform, TITLE);
    if (!target) return;

    try {
      const response = await fetch(target.url, {
        redirect: 'follow',
        headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8' },
        signal: AbortSignal.timeout(20_000),
      });

      const html = response.headers.get('content-type')?.includes('text')
        ? await response.text()
        : '';

      const verdict: Verdict =
        response.status === 404 || response.status === 410
          ? 'casse'
          : response.status === 403 || response.status === 429
            ? 'bloque'
            : NEEDLE.test(html)
              ? 'ok'
              : 'sans-resultat';

      results.push({ id: platform.id, verdict, detail: `HTTP ${response.status}` });
    } catch (error) {
      results.push({
        id: platform.id,
        verdict: 'injoignable',
        detail: error instanceof Error ? error.message.slice(0, 40) : 'erreur',
      });
    }
  }),
);

const labels: Record<Verdict, string> = {
  ok: '✔ le titre apparaît dans les résultats',
  bloque: '~ protection anti-robot, à vérifier dans un navigateur',
  'sans-resultat': '~ page rendue en JavaScript, à vérifier dans un navigateur',
  casse: '✘ page inexistante — à retirer du registre',
  injoignable: '✘ site injoignable',
};

const order: Verdict[] = ['casse', 'injoignable', 'sans-resultat', 'bloque', 'ok'];
results.sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict) || a.id.localeCompare(b.id));

console.log(`\nVérification des liens avec « ${TITLE} » :\n`);
for (const result of results) {
  console.log(`  ${result.id.padEnd(18)} ${result.detail.padEnd(10)} ${labels[result.verdict]}`);
}

const broken = results.filter((r) => r.verdict === 'casse' || r.verdict === 'injoignable');
console.log(
  `\n${results.length} plateformes testées, ${results.filter((r) => r.verdict === 'ok').length} confirmées, ${broken.length} à corriger.\n`,
);

process.exitCode = broken.length > 0 ? 1 : 0;
