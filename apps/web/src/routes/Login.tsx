import { useState, type FormEvent } from 'react';
import { useSession } from '../hooks/useSession';
import { Button, Card, Field, inputClass } from '../components/ui';

/**
 * L'instance est fermée : la création de compte demande un code d'invitation,
 * et le tout premier compte se crée en ligne de commande côté serveur.
 */
export function LoginPage() {
  const { login, register, useRecoveryCode } = useSession();
  const [mode, setMode] = useState<'login' | 'register' | 'recovery'>('login');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else if (mode === 'recovery') {
        await useRecoveryCode(recoveryCode, password);
      } else {
        await register({ email, password, displayName, inviteCode });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Connexion impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold">ScanLib</h1>
        <p className="mt-1 mb-6 text-sm text-[var(--text-muted)]">
          Vos scans, animés, séries et films au même endroit.
        </p>

        <form onSubmit={submit} className="space-y-4">
          {mode === 'recovery' ? (
            <Field
              label="Code de secours"
              hint="Fourni par l'administrateur de l'instance."
            >
              <input
                className={inputClass}
                value={recoveryCode}
                onChange={(event) => setRecoveryCode(event.target.value.toUpperCase())}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                required
                autoComplete="one-time-code"
              />
            </Field>
          ) : null}

          {mode === 'register' ? (
            <Field label="Nom affiché">
              <input
                className={inputClass}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                required
                autoComplete="nickname"
              />
            </Field>
          ) : null}

          {mode !== 'recovery' ? (
            <Field label="Adresse e-mail">
              <input
                type="email"
                className={inputClass}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
              />
            </Field>
          ) : null}

          <Field
            label={mode === 'recovery' ? 'Nouveau mot de passe' : 'Mot de passe'}
            hint={mode === 'login' ? undefined : '10 caractères minimum.'}
          >
            <input
              type="password"
              className={inputClass}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </Field>

          {mode === 'register' ? (
            <Field label="Code d'invitation">
              <input
                className={inputClass}
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value)}
                required
              />
            </Field>
          ) : null}

          {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}

          <Button type="submit" variant="primary" loading={busy} className="w-full">
            {mode === 'login'
              ? 'Se connecter'
              : mode === 'recovery'
                ? 'Reprendre la main'
                : 'Créer mon compte'}
          </Button>
        </form>

        <div className="mt-4 flex flex-col gap-2 text-xs text-[var(--text-muted)]">
          {mode === 'login' ? (
            <>
              <button
                type="button"
                onClick={() => setMode('register')}
                className="hover:text-[var(--text)]"
              >
                J&apos;ai un code d&apos;invitation
              </button>
              <button
                type="button"
                onClick={() => setMode('recovery')}
                className="hover:text-[var(--text)]"
              >
                Mot de passe oublié — j&apos;ai un code de secours
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setMode('login')}
              className="hover:text-[var(--text)]"
            >
              Retour à la connexion
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}
