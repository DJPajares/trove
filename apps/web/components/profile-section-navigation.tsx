import { getTranslations } from 'next-intl/server';

const sections = [
  ['profile', 'profileSection'],
  ['travel-preferences', 'preferencesSection'],
  ['appearance', 'appearanceSection'],
  ['notifications', 'notificationsSection'],
  ['offline-storage', 'offlineStorageSection'],
  ['privacy-security', 'privacySecuritySection'],
  ['account', 'accountSection'],
] as const;

export async function ProfileSectionNavigation() {
  const t = await getTranslations('profile');

  return (
    <aside className="hidden lg:sticky lg:top-[calc(var(--safe-top)+var(--header-height)+1.5rem)] lg:block">
      <nav aria-label={t('sectionNavigation')}>
        <p className="text-xs font-semibold tracking-[0.08em] text-text-subtle uppercase">
          {t('sectionNavigation')}
        </p>
        <ul className="mt-4 space-y-1 border-l border-border-subtle pl-3">
          {sections.map(([anchor, label]) => (
            <li key={anchor}>
              <a
                className="block rounded-[var(--radius-sm)] px-2 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                href={`#${anchor}`}
              >
                {t(label)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
