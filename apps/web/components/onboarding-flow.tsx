'use client';

import { Check, ChevronLeft, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

import { BrandLogo } from '@/components/brand-logo';
import { CountryCombobox } from '@/components/country-combobox';
import { CurrencyCombobox } from '@/components/currency-combobox';
import { MediaFrame } from '@/components/media-frame';
import { LiveDemo, PlanDemo, RememberDemo } from '@/components/onboarding/tour-demos';
import { TourHighlights } from '@/components/onboarding/tour-highlights';
import { PageState } from '@/components/page-state';
import { usePreferences } from '@/components/preferences-provider';
import { SCRIM } from '@/components/saved/finds-cover';
import { useTripCreation } from '@/components/trip-creation-provider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';
import { CoverArtworkCredit } from '@/components/cover-artwork-credit';
import { getSafeRedirectPath } from '@/lib/auth/redirect';
import { currencyForCountry } from '@/lib/currency/country-currency';
import * as Icons from '@/lib/icons';
import { dayHeaderFallback } from '@/lib/media/day-header-fallback';
import { pageEntrance } from '@/lib/page-entrance';
import { isProfileOnboarded } from '@/lib/profile/onboarding';
import { cn } from '@/lib/utils';

type Stage = 'welcome' | 'how' | 'highlights' | 'setup' | 'ready';
type HowTab = 'plan' | 'live' | 'remember';

type FormValues = {
  displayName: string;
  homeCountryCode: string;
  homeCurrencyCode: string;
};

const HOW_TABS = [
  { Demo: PlanDemo, icon: Icons.Itinerary, key: 'plan' },
  { Demo: LiveDemo, icon: Icons.TripMode, key: 'live' },
  { Demo: RememberDemo, icon: Icons.Memories, key: 'remember' },
] as const;

const SETUP_FORM = 'onboarding-setup';
const EYEBROW = 'text-[0.6875rem] font-bold tracking-[0.14em] text-brand uppercase';
const TITLE =
  'font-journal text-[2.125rem] leading-[1.02] font-normal tracking-[-0.01em] text-balance';
const em = (chunks: ReactNode) => <em>{chunks}</em>;

/**
 * A traveller's first minutes in Trove, as one full-screen flow: what Trove is,
 * its three parts to try by hand, a few things worth knowing, the three details
 * every trip starts from, and a way in.
 *
 * The details are the only step that saves anything, and the only one a
 * traveller cannot skip; Skip on the tour jumps straight to them. With `replay`
 * an onboarded traveller sees the tour again from Settings, without the details
 * they have already given.
 */
export function OnboardingFlow({
  next = '/',
  replay = false,
}: Readonly<{ next?: string; replay?: boolean }>) {
  const t = useTranslations('onboarding');
  const tourT = useTranslations('onboarding.tour');
  const appT = useTranslations('app');
  const router = useRouter();
  const nextPath = getSafeRedirectPath(next);
  const { profile, saveProfileChanges, status: preferencesStatus } = usePreferences();
  const { openCreateTrip } = useTripCreation();

  const [stage, setStage] = useState<Stage>('welcome');
  const [tab, setTab] = useState<HowTab>('plan');
  const [form, setForm] = useState<FormValues | null>(null);
  // The currency follows the country until the traveller picks one themselves.
  const [currencyChosen, setCurrencyChosen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!profile || form) return;
    if (isProfileOnboarded(profile) && !replay) {
      router.replace(nextPath);
      return;
    }
    setForm({
      displayName: profile.displayName ?? '',
      homeCountryCode: profile.homeCountryCode ?? '',
      homeCurrencyCode: profile.homeCurrencyCode ?? '',
    });
    setCurrencyChosen(Boolean(profile.homeCurrencyCode));
  }, [form, nextPath, profile, replay, router]);

  if (preferencesStatus === 'unavailable') {
    return <PageState kind="error" title={t('loadError')} />;
  }
  if (!form) {
    return <PageState kind="loading" title={t('loading')} />;
  }

  const stages: Stage[] = replay
    ? ['welcome', 'how', 'highlights', 'ready']
    : ['welcome', 'how', 'highlights', 'setup', 'ready'];
  const stageIndex = stages.indexOf(stage);
  const cover = stage === 'welcome';
  const name = form.displayName.trim();

  function show(nextStage: Stage, nextTab: HowTab = 'plan') {
    setError(false);
    setStage(nextStage);
    setTab(nextTab);
    scroller.current?.scrollTo({ top: 0 });
  }

  function advance() {
    if (stage === 'how' && tab !== 'remember') {
      setTab(tab === 'plan' ? 'live' : 'remember');
      scroller.current?.scrollTo({ top: 0 });
      return;
    }
    const following = stages[stageIndex + 1];
    if (following) show(following);
  }

  function goBack() {
    if (stage === 'how' && tab !== 'plan') {
      setTab(tab === 'remember' ? 'live' : 'plan');
      return;
    }
    const previous = stages[stageIndex - 1];
    if (previous) show(previous, previous === 'how' ? 'remember' : 'plan');
  }

  async function saveSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    const values = {
      displayName: form.displayName.trim(),
      homeCountryCode: form.homeCountryCode.trim().toUpperCase(),
      homeCurrencyCode: form.homeCurrencyCode.trim().toUpperCase(),
    };
    if (!values.displayName || !values.homeCountryCode || !values.homeCurrencyCode) return;

    setError(false);
    setSaving(true);
    try {
      await saveProfileChanges(values);
      setForm(values);
      show('ready');
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  function enter(createTrip: boolean) {
    router.replace(nextPath);
    if (createTrip) openCreateTrip();
  }

  const primaryLabel =
    stage === 'welcome'
      ? tourT('welcome.action')
      : stage === 'how'
        ? tourT(`how.next.${tab}`)
        : stage === 'highlights'
          ? replay
            ? tourT('highlights.actionReplay')
            : tourT('highlights.action')
          : stage === 'setup'
            ? saving
              ? t('saving')
              : tourT('setup.action')
            : replay
              ? tourT('ready.done')
              : tourT('ready.action');

  return (
    <div
      aria-labelledby="onboarding-heading"
      aria-modal="true"
      className="fixed inset-0 z-[var(--layer-overlay)] overflow-y-auto overscroll-contain bg-background text-foreground"
      data-slot="onboarding"
      ref={scroller}
      role="dialog"
    >
      {cover ? (
        <div aria-hidden="true" className="fixed inset-0 isolate bg-surface-media">
          <MediaFrame
            alt=""
            className={cn(
              'absolute inset-0 -z-20 h-full w-full rounded-none',
              // On a phone the photograph fills the screen top to bottom, so no
              // crop can lift its traveller above the words; it zooms in from
              // the foot instead, which brings them up into the open sky.
              'max-md:[&_img]:origin-bottom max-md:[&_img]:scale-150',
              pageEntrance.media,
            )}
            dataSlot="onboarding-cover"
            photographicPlaceholder={dayHeaderFallback.preview}
            preload
            sizes="100vw"
            source={{ kind: 'local', src: dayHeaderFallback.src }}
            variant="cover"
          />
          <div className={SCRIM} />
        </div>
      ) : null}

      <div
        className={cn(
          'relative mx-auto flex min-h-full w-full max-w-md flex-col px-5 pt-[calc(var(--safe-top)+0.5rem)] pb-[calc(var(--safe-bottom)+1.125rem)]',
          cover && 'text-white',
        )}
      >
        <header className="grid grid-cols-[2.75rem_minmax(0,1fr)_3.5rem] items-center gap-2 py-1">
          {stageIndex > 0 ? (
            <button
              aria-label={tourT('back')}
              className="grid size-11 place-items-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 rtl:rotate-180"
              onClick={goBack}
              type="button"
            >
              <ChevronLeft aria-hidden="true" className="size-5" />
            </button>
          ) : (
            <span />
          )}
          <ol
            aria-label={tourT('progress', { current: stageIndex + 1, total: stages.length })}
            className="grid grid-flow-col auto-cols-fr gap-1.5"
          >
            {stages.map((item, index) => (
              <li
                aria-hidden="true"
                className={cn(
                  'h-1 rounded-full transition-colors duration-[var(--motion-slow)] motion-reduce:transition-none',
                  index <= stageIndex
                    ? cover
                      ? 'bg-white'
                      : 'bg-primary'
                    : cover
                      ? 'bg-white/30'
                      : 'bg-border',
                )}
                key={item}
              />
            ))}
          </ol>
          {stage !== 'ready' && stage !== 'setup' ? (
            <button
              className={cn(
                'h-11 justify-self-end rounded-full px-1 text-[0.8125rem] font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/40',
                cover
                  ? 'text-white/90 hover:text-white'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => show(replay ? 'ready' : 'setup')}
              type="button"
            >
              {tourT('skip')}
            </button>
          ) : (
            <span />
          )}
        </header>

        <main
          className={cn(
            'flex flex-1 flex-col gap-4 py-3 motion-safe:animate-in motion-safe:duration-500 motion-safe:ease-[var(--ease-standard)] motion-safe:fade-in motion-safe:slide-in-from-bottom-3',
            cover ? 'justify-end' : stage === 'ready' && 'justify-center',
          )}
          key={stage}
        >
          {stage === 'welcome' ? (
            <>
              {/* On the photograph the logo takes its one-ink form, as the header does over a cover. */}
              <BrandLogo
                className="h-6 self-start [--brand-mark-type:var(--brand-mark-ink)] [--brand-symbol-bar:var(--brand-mark-ink)] [--brand-symbol-ribbon:var(--brand-mark-ink)]"
                name={appT('name')}
              />
              <h1
                className="max-w-[11ch] font-journal text-[clamp(2.75rem,13.5vw,3.5rem)] leading-[0.94] font-normal tracking-[-0.01em]"
                id="onboarding-heading"
              >
                {tourT.rich('welcome.title', { em })}
              </h1>
              <p className="max-w-[30ch] text-base leading-[1.5] text-pretty text-white/90">
                {tourT('welcome.description')}
              </p>
              <ul aria-hidden="true" className="flex flex-wrap gap-1.5">
                {(['before', 'during', 'after'] as const).map((moment) => (
                  <li
                    className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold"
                    key={moment}
                  >
                    {tourT(`welcome.${moment}`)}
                  </li>
                ))}
              </ul>
              <CoverArtworkCredit className="static self-end pt-1" />
            </>
          ) : null}

          {stage === 'how' ? (
            <>
              <div>
                <p className={EYEBROW}>{tourT('how.eyebrow')}</p>
                <h1 className={TITLE} id="onboarding-heading">
                  {tourT.rich('how.title', { em })}
                </h1>
              </div>
              <Tabs onValueChange={(value) => setTab(value as HowTab)} value={tab}>
                <TabsList aria-label={tourT('how.tabsLabel')} className="grid w-full grid-cols-3">
                  {HOW_TABS.map(({ icon: Icon, key }) => (
                    <TabsTab className="min-h-10" key={key} value={key}>
                      <Icon aria-hidden="true" />
                      {tourT(`how.tabs.${key}`)}
                    </TabsTab>
                  ))}
                  <TabsIndicator />
                </TabsList>
                {HOW_TABS.map(({ Demo, key }) => (
                  <TabsPanel className="mt-4 grid gap-3" keepMounted key={key} value={key}>
                    <p className="text-[0.9375rem] leading-6 text-pretty text-muted-foreground">
                      {tourT(`how.${key}.intro`)}{' '}
                      <span className="font-semibold text-foreground">
                        {tourT(`how.${key}.try`)}
                      </span>
                    </p>
                    <Demo />
                  </TabsPanel>
                ))}
              </Tabs>
            </>
          ) : null}

          {stage === 'highlights' ? (
            <>
              <div>
                <p className={EYEBROW}>{tourT('highlights.eyebrow')}</p>
                <h1 className={TITLE} id="onboarding-heading">
                  {tourT.rich('highlights.title', { em })}
                </h1>
              </div>
              <TourHighlights />
            </>
          ) : null}

          {stage === 'setup' ? (
            <>
              <div>
                <p className={EYEBROW}>{tourT('setup.eyebrow')}</p>
                <h1 className={TITLE} id="onboarding-heading">
                  {tourT.rich('setup.title', { em })}
                </h1>
                <p className="mt-1.5 text-[0.9375rem] leading-6 text-muted-foreground">
                  {tourT('setup.description')}
                </p>
              </div>
              {error ? (
                <Alert role="alert" variant="destructive">
                  <Icons.Error aria-hidden="true" />
                  <AlertDescription className="text-destructive">{t('saveError')}</AlertDescription>
                </Alert>
              ) : null}
              <form
                className="grid gap-5"
                id={SETUP_FORM}
                onSubmit={(event) => void saveSetup(event)}
              >
                <Field>
                  <FieldLabel htmlFor="onboarding-name">{t('name.title')}</FieldLabel>
                  <Input
                    autoComplete="name"
                    id="onboarding-name"
                    maxLength={100}
                    onChange={(event) => setForm({ ...form, displayName: event.target.value })}
                    placeholder={t('name.label')}
                    required
                    value={form.displayName}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="onboarding-location">{t('location.title')}</FieldLabel>
                  <CountryCombobox
                    aria-describedby="onboarding-location-hint"
                    aria-label={t('location.label')}
                    id="onboarding-location"
                    onValueChange={(value) => {
                      const suggested = currencyChosen ? null : currencyForCountry(value);
                      setForm({
                        ...form,
                        homeCountryCode: value,
                        homeCurrencyCode: suggested ?? form.homeCurrencyCode,
                      });
                    }}
                    placeholder={t('location.placeholder')}
                    required
                    value={form.homeCountryCode}
                  />
                  <FieldDescription id="onboarding-location-hint">
                    {t('location.hint')}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="onboarding-currency">{t('currency.title')}</FieldLabel>
                  <CurrencyCombobox
                    aria-describedby="onboarding-currency-hint"
                    aria-label={t('currency.label')}
                    id="onboarding-currency"
                    onValueChange={(value) => {
                      setCurrencyChosen(true);
                      setForm({ ...form, homeCurrencyCode: value });
                    }}
                    placeholder={t('currency.placeholder')}
                    required
                    value={form.homeCurrencyCode}
                  />
                  <FieldDescription id="onboarding-currency-hint">
                    {t('currency.hint')}
                  </FieldDescription>
                </Field>
              </form>
              <div
                aria-live="polite"
                className="grid gap-1 rounded-[var(--radius-xl)] bg-surface-tint p-4"
              >
                <p className="font-journal text-[1.375rem] leading-tight font-normal">
                  {name ? tourT('setup.previewNamed', { name }) : tourT('setup.preview')}
                </p>
                <p className="text-sm leading-6 text-pretty text-muted-foreground">
                  {form.homeCurrencyCode
                    ? tourT('setup.previewCurrency', { currency: form.homeCurrencyCode })
                    : tourT('setup.previewDetail')}
                </p>
              </div>
            </>
          ) : null}

          {stage === 'ready' ? (
            <>
              <div>
                <p className={EYEBROW}>{tourT('ready.eyebrow')}</p>
                <h1 className={TITLE} id="onboarding-heading">
                  {name
                    ? tourT.rich('ready.title', { em, name })
                    : tourT.rich('ready.titleUnnamed', { em })}
                </h1>
                <p className="mt-1.5 text-[0.9375rem] leading-6 text-pretty text-muted-foreground">
                  {tourT('ready.description')}
                </p>
              </div>
              <ul className="grid gap-2.5">
                {(['one', 'two', 'three'] as const).map((point) => (
                  <li className="flex items-start gap-2.5 text-sm leading-6" key={point}>
                    <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-brand" />
                    {tourT(`ready.points.${point}`)}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </main>

        <footer className="grid gap-1 pt-2">
          {stage === 'setup' ? (
            <Button disabled={saving} form={SETUP_FORM} size="lg" type="submit">
              {primaryLabel}
            </Button>
          ) : (
            <Button
              className={cn(
                '',
                cover && 'bg-white text-neutral-900 hover:bg-white/90 focus-visible:ring-white/70',
              )}
              onClick={stage === 'ready' ? () => enter(!replay) : advance}
              size="lg"
              type="button"
            >
              {primaryLabel}
            </Button>
          )}
          {stage === 'ready' ? (
            <div className="flex flex-wrap items-center justify-center gap-x-5">
              {replay ? null : (
                <button
                  className="inline-flex min-h-11 items-center rounded-full text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
                  onClick={() => enter(false)}
                  type="button"
                >
                  {tourT('ready.later')}
                </button>
              )}
              <button
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
                onClick={() => show('welcome')}
                type="button"
              >
                <RotateCcw aria-hidden="true" className="size-4" />
                {tourT('ready.replay')}
              </button>
            </div>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
