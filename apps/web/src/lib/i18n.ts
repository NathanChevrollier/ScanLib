/**
 * Traduction maison : deux langues, quelques dizaines de chaînes, aucune
 * pluralisation complexe. Une dépendance i18n complète coûterait plus cher que
 * ce fichier en poids de bundle comme en configuration.
 */
export type UiLanguage = 'fr' | 'en';

const dictionary = {
  'nav.library': { fr: 'Bibliothèque', en: 'Library' },
  'nav.search': { fr: 'Recherche', en: 'Search' },
  'nav.calendar': { fr: 'Calendrier', en: 'Calendar' },
  'nav.queue': { fr: 'À voir', en: 'Up next' },
  'nav.stats': { fr: 'Statistiques', en: 'Stats' },
  'nav.settings': { fr: 'Réglages', en: 'Settings' },
  'nav.profile': { fr: 'Profil', en: 'Profile' },
  'nav.admin': { fr: 'Administration', en: 'Administration' },
  'nav.groupTracking': { fr: 'Ma collection', en: 'My collection' },
  'nav.groupAccount': { fr: 'Mon compte', en: 'My account' },

  'common.all': { fr: 'Tout', en: 'All' },
  'common.loading': { fr: 'Chargement…', en: 'Loading…' },
  'common.retry': { fr: 'Réessayer', en: 'Retry' },
  'common.cancel': { fr: 'Annuler', en: 'Cancel' },
  'common.save': { fr: 'Enregistrer', en: 'Save' },
  'common.close': { fr: 'Fermer', en: 'Close' },
  'common.add': { fr: 'Ajouter', en: 'Add' },
  'common.remove': { fr: 'Retirer', en: 'Remove' },
  'common.official': { fr: 'Officiel', en: 'Official' },
  'common.search': { fr: 'Rechercher', en: 'Search' },
  'common.offline': { fr: 'Hors ligne', en: 'Offline' },
  'common.none': { fr: 'Aucun résultat', en: 'No results' },

  'library.empty': {
    fr: 'Votre bibliothèque est vide. Cherchez une série pour commencer.',
    en: 'Your library is empty. Search for a series to get started.',
  },
  'library.count': { fr: 'œuvres', en: 'works' },
  'library.filters': { fr: 'Filtres', en: 'Filters' },
  'library.sort': { fr: 'Trier par', en: 'Sort by' },
  'library.newUnits': { fr: 'Nouveautés', en: 'New' },

  'work.continue': { fr: 'Continuer', en: 'Continue' },
  'work.start': { fr: 'Commencer', en: 'Start' },
  'work.whereToRead': { fr: 'Où lire', en: 'Where to read' },
  'work.whereToWatch': { fr: 'Où regarder', en: 'Where to watch' },
  'work.chapters': { fr: 'Chapitres', en: 'Chapters' },
  'work.episodes': { fr: 'Épisodes', en: 'Episodes' },
  'work.markUpTo': { fr: "Marquer jusqu'ici", en: 'Mark up to here' },
  'work.noLinks': {
    fr: 'Aucun lien officiel trouvé pour vos langues et régions.',
    en: 'No official link found for your languages and regions.',
  },
  'work.searchLink': {
    fr: 'Lien de recherche : la plateforme ne publie pas de lien direct.',
    en: 'Search link: this platform publishes no direct link.',
  },

  'search.placeholder': {
    fr: 'Un scan, un animé, une série, un film…',
    en: 'A manga, an anime, a series, a movie…',
  },
  'search.degraded': { fr: 'Source indisponible', en: 'Source unavailable' },

  'calendar.empty': {
    fr: 'Rien de prévu sur cette période pour vos séries.',
    en: 'Nothing scheduled for your series in this period.',
  },
  'calendar.available': { fr: 'Disponible', en: 'Available' },
  'calendar.addRelease': { fr: 'Ajouter une sortie', en: 'Add a release' },
  'calendar.editRelease': { fr: 'Modifier la sortie', en: 'Edit release' },
  'calendar.mySchedules': { fr: 'Mes rythmes de sortie', en: 'My release rhythms' },
  'calendar.schedulesHint': {
    fr: "Une récurrence remplace la date annoncée par les sources pour cette œuvre.",
    en: 'A rhythm you set replaces the date announced by the sources for that work.',
  },
  'calendar.frequency': { fr: 'Rythme', en: 'Rhythm' },
  'calendar.freq.once': { fr: 'Une seule fois', en: 'One-off' },
  'calendar.freq.daily': { fr: 'Tous les jours', en: 'Daily' },
  'calendar.freq.weekly': { fr: 'Chaque semaine', en: 'Weekly' },
  'calendar.freq.monthly': { fr: 'Chaque mois', en: 'Monthly' },
  'calendar.weekday': { fr: 'Jour de la semaine', en: 'Day of the week' },
  'calendar.dayOfMonth': { fr: 'Jour du mois', en: 'Day of the month' },
  'calendar.timeOfDay': { fr: 'Heure', en: 'Time' },
  'calendar.firstRelease': { fr: 'Première sortie', en: 'First release' },
  'calendar.startNumber': { fr: 'Numéro de départ', en: 'Starting number' },
  'calendar.autofill': { fr: 'Pré-remplir depuis les sources', en: 'Prefill from sources' },

  'profile.title': { fr: 'Mon profil', en: 'My profile' },
  'profile.subtitle': {
    fr: 'Identité, mot de passe, appareils connectés et notifications.',
    en: 'Identity, password, connected devices and notifications.',
  },

  'queue.toStart': { fr: 'À commencer', en: 'To start' },
  'queue.binge': { fr: 'Prêt à enchaîner', en: 'Ready to binge' },
  'queue.stalled': { fr: 'En sommeil', en: 'Stalled' },
  'queue.recommendations': { fr: 'Recommandations', en: 'Recommendations' },

  'stats.watched': { fr: 'Épisodes vus', en: 'Episodes watched' },
  'stats.read': { fr: 'Chapitres lus', en: 'Chapters read' },
  'stats.time': { fr: 'Temps estimé', en: 'Estimated time' },
  'stats.streak': { fr: 'Série en cours', en: 'Current streak' },
  'stats.activity': { fr: 'Activité sur un an', en: 'Activity over a year' },
  'stats.genres': { fr: 'Genres favoris', en: 'Top genres' },
  'stats.scores': { fr: 'Répartition des notes', en: 'Score distribution' },

  'settings.languages': { fr: 'Langues préférées', en: 'Preferred languages' },
  'settings.regions': { fr: 'Régions', en: 'Regions' },
  'settings.platforms': { fr: 'Mes plateformes', en: 'My platforms' },
  'settings.officialOnly': { fr: 'Liens officiels uniquement', en: 'Official links only' },
  'settings.providers': { fr: 'État des sources', en: 'Source health' },
  'settings.theme': { fr: 'Thème', en: 'Theme' },
  'settings.export': { fr: 'Exporter ma bibliothèque', en: 'Export my library' },
  'settings.invite': { fr: 'Créer une invitation', en: 'Create an invite' },
  'settings.logout': { fr: 'Se déconnecter', en: 'Log out' },
} as const;

export type TranslationKey = keyof typeof dictionary;

export function translate(key: TranslationKey, language: UiLanguage): string {
  return dictionary[key][language];
}
