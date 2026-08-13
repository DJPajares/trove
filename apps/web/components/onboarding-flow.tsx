'use client';

import { Coins, MapPinned, Sparkles, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { PageState } from '@/components/page-state';
import { usePreferences } from '@/components/preferences-provider';
import { CurrencyCombobox } from '@/components/currency-combobox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  firstIncompleteStep,
  isProfileOnboarded,
  type OnboardingStep,
} from '@/lib/profile/onboarding';

type FormValues = {
  displayName: string;
  homeCurrencyCode: string;
  homeLocation: string;
};

const stepIcons: Record<OnboardingStep, typeof UserRound> = {
  currency: Coins,
  location: MapPinned,
  name: UserRound,
};

const stepOrder: OnboardingStep[] = ['name', 'location', 'currency'];

export function OnboardingFlow() {
  const t = useTranslations('onboarding');
  const router = useRouter();
  const { profile, saveProfileChanges, status: preferencesStatus } = usePreferences();

  const [step, setStep] = useState<OnboardingStep | null>(null);
  const [form, setForm] = useState<FormValues | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!profile || step) return;
    if (isProfileOnboarded(profile)) {
      router.replace('/');
      return;
    }
    setForm({
      displayName: profile.displayName ?? '',
      homeCurrencyCode: profile.homeCurrencyCode ?? '',
      homeLocation: profile.homeLocation ?? '',
    });
    setStep(firstIncompleteStep(profile));
  }, [profile, router, step]);

  if (preferencesStatus === 'unavailable') {
    return <PageState kind="error" title={t('loadError')} />;
  }

  if (!step || !form) {
    return <PageState kind="loading" title={t('loading')} />;
  }

  const stepIndex = stepOrder.indexOf(step);
  const StepIcon = stepIcons[step];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;

    const trimmed = {
      displayName: form.displayName.trim(),
      homeCurrencyCode: form.homeCurrencyCode.trim().toUpperCase(),
      homeLocation: form.homeLocation.trim(),
    };
    if (
      (step === 'name' && !trimmed.displayName) ||
      (step === 'location' && !trimmed.homeLocation) ||
      (step === 'currency' && !trimmed.homeCurrencyCode)
    ) {
      return;
    }

    setError(false);
    setSaving(true);
    try {
      if (step === 'name') {
        await saveProfileChanges({ displayName: trimmed.displayName });
        setForm({ ...form, displayName: trimmed.displayName });
        setStep('location');
      } else if (step === 'location') {
        await saveProfileChanges({ homeLocation: trimmed.homeLocation });
        setForm({ ...form, homeLocation: trimmed.homeLocation });
        setStep('currency');
      } else {
        await saveProfileChanges({ homeCurrencyCode: trimmed.homeCurrencyCode });
        router.replace('/');
        return;
      }
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  function goBack() {
    setError(false);
    if (step === 'location') setStep('name');
    else if (step === 'currency') setStep('location');
  }

  return (
    <Card className="w-full max-w-md sm:[--card-spacing:--spacing(6)]">
      <CardHeader>
        <div className="mb-3 flex size-12 items-center justify-center rounded-[var(--radius-lg)] bg-brand/10 text-brand">
          <StepIcon aria-hidden="true" className="size-6" />
        </div>
        <p aria-live="polite" className="text-sm font-medium text-muted-foreground">
          {t('stepLabel', { current: stepIndex + 1, total: stepOrder.length })}
        </p>
        <h1
          className="mt-1 text-3xl leading-tight font-semibold tracking-tight text-pretty text-foreground"
          id="onboarding-heading"
        >
          {t(`${step}.title`)}
        </h1>
        <p className="mt-1 text-base leading-7 text-pretty text-muted-foreground">
          {t(`${step}.description`)}
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {stepIndex === 0 ? (
          <p className="text-sm leading-6 text-muted-foreground">
            <Sparkles aria-hidden="true" className="mr-1.5 inline size-4 text-brand" />
            {t('welcome')}
          </p>
        ) : null}

        {error ? (
          <Alert role="alert" variant="destructive">
            <AlertDescription className="text-destructive">{t('saveError')}</AlertDescription>
          </Alert>
        ) : null}

        <form className="space-y-6" onSubmit={handleSubmit}>
          {step === 'name' ? (
            <Field>
              <FieldLabel htmlFor="onboarding-name">{t('name.label')}</FieldLabel>
              <Input
                autoComplete="name"
                autoFocus
                id="onboarding-name"
                maxLength={100}
                onChange={(event) => setForm({ ...form, displayName: event.target.value })}
                required
                value={form.displayName}
              />
            </Field>
          ) : null}

          {step === 'location' ? (
            <Field>
              <FieldLabel htmlFor="onboarding-location">{t('location.label')}</FieldLabel>
              <Input
                aria-describedby="onboarding-location-hint"
                autoFocus
                id="onboarding-location"
                maxLength={200}
                onChange={(event) => setForm({ ...form, homeLocation: event.target.value })}
                required
                value={form.homeLocation}
              />
              <FieldDescription id="onboarding-location-hint">
                {t('location.hint')}
              </FieldDescription>
            </Field>
          ) : null}

          {step === 'currency' ? (
            <Field>
              <FieldLabel htmlFor="onboarding-currency">{t('currency.label')}</FieldLabel>
              <CurrencyCombobox
                aria-describedby="onboarding-currency-hint"
                aria-label={t('currency.label')}
                id="onboarding-currency"
                onValueChange={(value) => setForm({ ...form, homeCurrencyCode: value })}
                placeholder={t('currency.placeholder')}
                required
                value={form.homeCurrencyCode}
              />
              <FieldDescription id="onboarding-currency-hint">
                {t('currency.hint')}
              </FieldDescription>
            </Field>
          ) : null}

          <div className="flex items-center gap-3">
            {stepIndex > 0 ? (
              <Button disabled={saving} onClick={goBack} type="button" variant="outline">
                {t('back')}
              </Button>
            ) : null}
            <Button className="flex-1" disabled={saving} type="submit">
              {saving
                ? t('saving')
                : stepIndex === stepOrder.length - 1
                  ? t('finish')
                  : t('continue')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
