'use client';

import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { usePreferences } from '@/components/preferences-provider';
import { Button } from '@/components/ui/button';
import { toggleAppearance } from '@/lib/profile/preferences';
import { floatingActionTriggerClass } from '@/lib/shell/floating-actions';
import { cn } from '@/lib/utils';

type AppearanceToggleProps = {
  triggerVariant?: 'floating' | 'icon';
};

export function AppearanceToggle({
  triggerVariant = 'icon',
}: Readonly<AppearanceToggleProps> = {}) {
  const t = useTranslations('appearance');
  const { preferences, setAppearance } = usePreferences();
  const dark = preferences.appearance === 'dark';
  const Icon = dark ? Moon : Sun;
  const floating = triggerVariant === 'floating';

  return (
    <Button
      aria-label={t('darkMode')}
      aria-pressed={dark}
      className={cn('text-foreground', floating && floatingActionTriggerClass)}
      data-translucent-surface={floating ? '' : undefined}
      onClick={() => setAppearance(toggleAppearance(preferences.appearance))}
      size={floating ? 'icon' : 'icon-sm'}
      title={t(dark ? 'switchToLight' : 'switchToDark')}
      type="button"
      variant={dark ? 'secondary' : 'ghost'}
    >
      <Icon
        aria-hidden="true"
        className={cn(floating ? 'size-5' : 'size-4', dark && 'fill-current')}
      />
    </Button>
  );
}
