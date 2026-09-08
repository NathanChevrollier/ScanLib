import { useNavigate } from 'react-router-dom';
import { LogOut, ShieldCheck } from 'lucide-react';
import { AccountSettings } from '../components/AccountSettings';
import { useSession } from '../hooks/useSession';
import { Badge, Button, Card, PageHeader } from '../components/ui';

/** Tout ce qui touche à l'identité du compte, séparé des préférences. */
export function ProfilePage() {
  const { user, logout, t } = useSession();
  const navigate = useNavigate();

  if (!user) return null;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <PageHeader
        title={t('profile.title')}
        subtitle={t('profile.subtitle')}
        action={
          <Button variant="danger" icon={<LogOut size={16} />} onClick={() => void logout()}>
            {t('settings.logout')}
          </Button>
        }
      />

      <Card className="flex flex-wrap items-center gap-4 p-5">
        <Avatar name={user.displayName} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold">{user.displayName}</p>
          <p className="truncate text-sm text-[var(--text-muted)]">{user.email}</p>
        </div>
        {user.role === 'admin' ? (
          <div className="flex items-center gap-3">
            <Badge color="var(--color-accent)">{t('nav.admin')}</Badge>
            <Button icon={<ShieldCheck size={16} />} onClick={() => navigate('/admin')}>
              {t('nav.admin')}
            </Button>
          </div>
        ) : null}
      </Card>

      <AccountSettings />
    </div>
  );
}

/** Initiales plutôt qu'une image : rien à téléverser, rien à héberger. */
function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <span
      aria-hidden
      className="flex size-14 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/20 text-xl font-semibold text-[var(--color-accent-soft)]"
    >
      {initials || '?'}
    </span>
  );
}
