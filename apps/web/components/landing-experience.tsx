import { CalendarDays, Compass, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ComponentType } from 'react';

import { Button } from '@/components/ui/button';

type ExperienceKey = 'plan' | 'live' | 'remember';

/**
 * The three experiences in the stable order PRD section 4.5 fixes for them, with
 * the icons the rest of the product already uses for each.
 */
const EXPERIENCES: { icon: ComponentType<{ className?: string }>; key: ExperienceKey }[] = [
  { icon: CalendarDays, key: 'plan' },
  { icon: Compass, key: 'live' },
  { icon: Sparkles, key: 'remember' },
];

const SUPPORTING_KEYS = ['saved', 'routes', 'logistics', 'expenses', 'offline'] as const;

/**
 * What someone sees at `/` before they have an account. Everything here
 * describes capability Trove actually ships — there is no sample data and no
 * rendering of product UI, so nothing on this page can drift out of sync with
 * the product it is describing.
 */
export function LandingExperience() {
  const t = useTranslations('landing');

  return (
    <div className="mx-auto w-full max-w-5xl space-y-16 md:space-y-24">
      <section
        aria-labelledby="landing-heading"
        className="relative isolate overflow-hidden rounded-[var(--radius-2xl)] border border-border bg-surface-raised px-5 py-12 sm:px-10 md:py-20"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(75%_120%_at_10%_0%,color-mix(in_oklch,var(--brand),transparent_88%),transparent_62%),radial-gradient(55%_100%_at_100%_5%,color-mix(in_oklch,var(--accent),transparent_88%),transparent_65%)]"
        />

        <h1
          className="max-w-[18ch] text-[clamp(2.125rem,7vw,3.75rem)] leading-[1.08] font-semibold tracking-[-0.03em] text-balance text-foreground"
          id="landing-heading"
        >
          {t('heroTitle')}
        </h1>
        <p className="mt-5 max-w-[62ch] text-base leading-7 text-pretty text-muted-foreground md:text-lg md:leading-8">
          {t('heroDescription')}
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            className="w-full sm:w-auto"
            nativeButton={false}
            render={<Link href="/sign-up" />}
            size="lg"
          >
            {t('heroPrimary')}
          </Button>
          <Button
            className="w-full sm:w-auto"
            nativeButton={false}
            render={<Link href="/sign-in" />}
            size="lg"
            variant="outline"
          >
            {t('heroSecondary')}
          </Button>
        </div>
      </section>

      <section aria-labelledby="landing-experiences-heading">
        <h2
          className="text-[clamp(1.5rem,4vw,2rem)] leading-tight font-semibold tracking-[-0.025em] text-pretty text-foreground"
          id="landing-experiences-heading"
        >
          {t('experiencesTitle')}
        </h2>
        <p className="mt-3 max-w-[62ch] text-base leading-7 text-pretty text-muted-foreground">
          {t('experiencesDescription')}
        </p>

        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {EXPERIENCES.map(({ icon: Icon, key }) => (
            <li
              className="rounded-[var(--radius-lg)] border border-border bg-card p-5 shadow-[var(--shadow-control)] sm:p-6"
              key={key}
            >
              <span className="flex size-11 items-center justify-center rounded-[var(--radius-md)] bg-brand/10 text-brand">
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <p className="mt-4 text-sm font-medium tracking-[0.01em] text-brand">
                {t(`experiences.${key}.eyebrow`)}
              </p>
              <h3 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-foreground">
                {t(`experiences.${key}.title`)}
              </h3>
              <p className="mt-2 text-sm leading-6 text-pretty text-muted-foreground">
                {t(`experiences.${key}.description`)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="landing-supporting-heading">
        <h2
          className="text-[clamp(1.5rem,4vw,2rem)] leading-tight font-semibold tracking-[-0.025em] text-pretty text-foreground"
          id="landing-supporting-heading"
        >
          {t('alsoTitle')}
        </h2>
        <ul className="mt-6 grid gap-x-8 gap-y-4 md:grid-cols-2">
          {SUPPORTING_KEYS.map((key) => (
            <li className="flex gap-3 border-t border-border pt-4" key={key}>
              <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
              <p className="text-sm leading-6 text-pretty text-muted-foreground">
                {t(`also.${key}`)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="landing-closing-heading"
        className="rounded-[var(--radius-lg)] border border-border bg-card p-6 shadow-[var(--shadow-control)] sm:p-8"
      >
        <h2
          className="text-2xl font-semibold tracking-[-0.02em] text-pretty text-foreground"
          id="landing-closing-heading"
        >
          {t('closingTitle')}
        </h2>
        <p className="mt-2 max-w-[58ch] text-sm leading-6 text-pretty text-muted-foreground">
          {t('closingDescription')}
        </p>
        <Button
          className="mt-6 w-full sm:w-auto"
          nativeButton={false}
          render={<Link href="/sign-up" />}
          size="lg"
        >
          {t('closingAction')}
        </Button>
      </section>
    </div>
  );
}
