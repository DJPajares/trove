'use client';

import { useTranslations } from 'next-intl';

import { HomeWeatherPill } from '@/components/home-weather-pill';
import { usePreferences } from '@/components/preferences-provider';
import type { HomeWeatherTarget } from '@/lib/home/weather';

export type HomeGreetingProps = {
  /** Where the weather is for, named. Null when Home has no trip to ask about. */
  locationLabel: string | null;
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
 * Two words rather than a time of day, at section rather than page scale.
 * "Good evening, <name>" ran to two lines on a phone, and even shortened it
 * cannot share a row with the weather at page-title size. It does not need to
 * be the biggest thing here: the trip's own name is, one section down, and a
 * greeting that competes with it is a greeting shouting.
 *
 * Dropping the hour also drops the one thing on this line that could not be
 * known while the server rendered. The name can: it arrives with the profile
 * query, and the server and the first client render agree it is not there yet.
 */
export function HomeGreeting({ locationLabel, weatherTarget }: Readonly<HomeGreetingProps>) {
  const t = useTranslations('home');
  const { profile } = usePreferences();
  const name = profile?.displayName?.trim();

  return (
    // The floating Search/Account stack is pinned to the top right of every
    // signed-in viewport. On mobile it has no header to sit in, so the row has
    // to end before it rather than run underneath it.
    <div className="flex items-center justify-between gap-4 pe-[3.25rem] sm:pe-0">
      <h1
        className="min-w-0 truncate text-[length:var(--text-section-title)] leading-[1.2] font-semibold tracking-[-0.025em] text-foreground"
        id="home-heading"
      >
        {name ? t('greeting.hi', { name }) : t('greeting.fallback')}
      </h1>

      {weatherTarget ? (
        <HomeWeatherPill locationLabel={locationLabel} target={weatherTarget} />
      ) : null}
    </div>
  );
}
