'use client';

import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { usePreferences } from '@/components/preferences-provider';
import { Button } from '@/components/ui/button';
import { toggleAppearance } from '@/lib/profile/preferences';

export function AppearanceToggle() {
  const t = useTranslations('appearance');
  const { preferences, setAppearance } = usePreferences();
  const dark = preferences.appearance === 'dark';
  const Icon = dark ? Moon : Sun;

  return (
    <Button
      aria-label={t('darkMode')}
      aria-pressed={dark}
      className="text-foreground"
      onClick={() => setAppearance(toggleAppearance(preferences.appearance))}
      size="icon-sm"
      title={t(dark ? 'switchToLight' : 'switchToDark')}
      type="button"
      variant={dark ? 'secondary' : 'ghost'}
    >
      <Icon aria-hidden="true" className={dark ? 'fill-current' : undefined} />
    </Button>
  );
}
