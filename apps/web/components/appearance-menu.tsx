'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { appMenuActionClassName } from '@/components/app-menu-action';
import { usePreferences } from '@/components/preferences-provider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Appearance = 'dark' | 'light' | 'system';

const appearanceIcons = {
  dark: Moon,
  light: Sun,
  system: Monitor,
};

export function AppearanceMenu({ label }: Readonly<{ label?: string }> = {}) {
  const t = useTranslations('appearance');
  const { appearanceSaveError, preferences, setAppearance } = usePreferences();
  const appearance = preferences.appearance;
  const CurrentIcon = appearanceIcons[appearance];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={label ?? t('button')}
            className={label ? appMenuActionClassName : undefined}
            size={label ? 'default' : 'icon'}
            type="button"
            variant={label ? 'outline' : 'ghost'}
          />
        }
      >
        <CurrentIcon aria-hidden="true" className={label ? 'size-5 text-brand' : 'size-4'} />
        {label ? <span>{label}</span> : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuRadioGroup
          onValueChange={(value) => setAppearance(value as Appearance)}
          value={appearance}
        >
          {(Object.keys(appearanceIcons) as Appearance[]).map((option) => {
            const Icon = appearanceIcons[option];

            return (
              <DropdownMenuRadioItem key={option} value={option}>
                <Icon aria-hidden="true" className="size-4" />
                {t(option)}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        {appearanceSaveError ? (
          <p className="px-2 py-1.5 text-xs leading-4 text-destructive" role="status">
            {t('unsaved')}
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
