'use client';

import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { usePreferences } from '@/components/preferences-provider';
import { Button } from '@/components/ui/button';
import { toggleAppearance } from '@/lib/profile/preferences';
import { cn } from '@/lib/utils';

type AppearanceToggleProps = {
  triggerVariant?: 'icon' | 'quickAction';
};

export function AppearanceToggle({
  triggerVariant = 'icon',
}: Readonly<AppearanceToggleProps> = {}) {
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
      size={triggerVariant === 'quickAction' ? 'quick-action' : 'icon-sm'}
      title={t(dark ? 'switchToLight' : 'switchToDark')}
      type="button"
      variant={dark ? 'secondary' : 'ghost'}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          triggerVariant === 'quickAction' ? 'size-3.5' : 'size-4',
          dark && 'fill-current',
        )}
      />
      {triggerVariant === 'quickAction' ? <span>{t('label')}</span> : null}
    </Button>
  );
}
