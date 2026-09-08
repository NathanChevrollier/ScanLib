import { SearchPanel } from '../components/SearchPanel';
import { useSession } from '../hooks/useSession';

/** Page de recherche plein écran — l'équivalent tactile de la palette ⌘K. */
export function SearchPage() {
  const { t } = useSession();
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t('nav.search')}</h1>
      <SearchPanel autoFocus />
    </div>
  );
}
