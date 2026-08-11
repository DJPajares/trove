'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

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

export function AppearanceMenu() {
  const t = useTranslations('appearance');
  const { setTheme, theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const appearance = mounted && (theme === 'dark' || theme === 'light') ? theme : 'system';
  const CurrentIcon = appearanceIcons[appearance];

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button aria-label={t('button')} size="icon" type="button" variant="ghost" />}
      >
        <CurrentIcon aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuRadioGroup onValueChange={setTheme} value={appearance}>
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
