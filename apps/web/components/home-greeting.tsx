'use client';

import { useTranslations } from 'next-intl';

import { HomeWeatherPill } from '@/components/home-weather-inset';
import { usePreferences } from '@/components/preferences-provider';
import type { HomeWeatherTarget } from '@/lib/home/weather';

/**
 * Which half of the day it is where the traveller is standing.
 *
 * The device clock rather than the trip's: this line greets the person reading
 * it, and someone planning a trip to Tokyo from their kitchen in Lisbon is
 * having a Lisbon morning.
 */
export function greetingKey(now = new Date()): 'afternoon' | 'evening' | 'morning' {
  const hour = now.getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';

  return 'evening';
}

export type HomeGreetingProps = {
  weatherTarget: HomeWeatherTarget | null;
};

/**
 * Home's opening line: who is reading, and what the sky is doing.
 *
 * The greeting is the page's `h1`. Home used to lead with the focal trip's
 * lifecycle - "Under way", "Coming up" - which named the trip's state twice,
 * once here and again on the card below it. The trip keeps that job; this
 * says hello.
 *
 * The hour is read on the client and the name arrives with the profile query,
 * so neither is knowable while the server renders. `suppressHydrationWarning`
 * covers the first: the text is meant to differ between the two renders, and
 * the alternative - holding the greeting back until after mount - trades a
 * warning for a flash of nothing at the top of the page.
 */
export function HomeGreeting({ weatherTarget }: Readonly<HomeGreetingProps>) {
  const t = useTranslations('home');
  const { profile } = usePreferences();
  const name = profile?.displayName?.trim();
  const greeting = t(`greeting.${greetingKey()}`);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      {/* The floating Search/Account stack is pinned to the top right of every
          signed-in viewport. On mobile it has no header to sit in, so it lands
          on top of this line unless the line gets out of its way. */}
      <div className="min-w-0 pe-[3.25rem] sm:pe-0">
        <h1
          className="text-[length:var(--text-page-title)] leading-[1.08] font-semibold tracking-[-0.035em] text-balance text-foreground"
          id="home-heading"
          suppressHydrationWarning
        >
          {name ? t('greeting.named', { greeting, name }) : greeting}
        </h1>
      </div>

      {weatherTarget ? (
        <div className="shrink-0 sm:pt-1">
          <HomeWeatherPill target={weatherTarget} />
        </div>
      ) : null}
    </div>
  );
}
