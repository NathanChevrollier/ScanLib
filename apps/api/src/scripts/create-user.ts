import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { closeDatabase } from '../db/client.js';
import { registerUser } from '../services/users.js';

/**
 * Création de compte en ligne de commande — l'inscription publique étant
 * fermée, c'est la porte d'entrée sur une instance neuve :
 *
 *   npm run user:create -- --email moi@exemple.fr --name Nathan
 *
 * Le mot de passe est demandé de façon interactive s'il n'est pas passé en
 * argument, pour ne pas laisser de trace dans l'historique du shell.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rl = createInterface({ input: stdin, output: stdout });

  const email = args.email ?? (await rl.question('Adresse e-mail : '));
  const displayName = args.name ?? (await rl.question("Nom d'affichage : "));
  const password = args.password ?? (await rl.question('Mot de passe (10 caractères min.) : '));

  rl.close();

  if (password.length < 10) {
    throw new Error('Le mot de passe doit faire au moins 10 caractères.');
  }

  const user = await registerUser({
    email,
    password,
    displayName,
    skipInvite: true,
    ...(args.admin ? { role: 'admin' as const } : {}),
  });

  console.log(`Compte créé : ${user.email} (${user.role})`);
  await closeDatabase();
}

function parseArgs(argv: string[]): {
  email?: string;
  name?: string;
  password?: string;
  admin?: boolean;
} {
  const result: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) result[key] = true;
    else {
      result[key] = next;
      i += 1;
    }
  }
  return result as { email?: string; name?: string; password?: string; admin?: boolean };
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await closeDatabase().catch(() => undefined);
  process.exitCode = 1;
});
