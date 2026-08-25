'use client';

import Image from 'next/image';
import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';

import { PageState } from '@/components/page-state';
import { usePreferences } from '@/components/preferences-provider';
import { CurrencyCombobox } from '@/components/currency-combobox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { removeProfilePhoto, type Profile, uploadProfilePhoto } from '@/lib/profile/api';
import { getPreferenceDefaults, type ProfilePreferences } from '@/lib/profile/preferences';
import { cn } from '@/lib/utils';

type FormState = ProfilePreferences & {
  displayName: string;
  homeCurrencyCode: string;
  homeLocation: string;
};

function getFormState(profile: Profile, locale: string): FormState {
  const defaults = getPreferenceDefaults(locale);

  return {
    ...defaults,
    appearance: profile.appearance ?? defaults.appearance,
    dateFormat: profile.dateFormat ?? defaults.dateFormat,
    distanceUnit: profile.distanceUnit ?? defaults.distanceUnit,
    displayName: profile.displayName ?? '',
    homeCurrencyCode: profile.homeCurrencyCode ?? '',
    homeLocation: profile.homeLocation ?? '',
    temperatureUnit: profile.temperatureUnit ?? defaults.temperatureUnit,
    timeFormat: profile.timeFormat ?? defaults.timeFormat,
  };
}

export function ProfileSettingsForm({ locale }: { locale: string }) {
  const t = useTranslations('profile');
  const {
    appearanceSaveError,
    preferences,
    profile,
    saveProfileChanges,
    setAppearance,
    status: preferencesStatus,
  } = usePreferences();
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'saved'>('loading');
  const [photoBusy, setPhotoBusy] = useState(false);

  useEffect(() => {
    if (profile && !form) {
      setForm(getFormState(profile, locale));
      setStatus('idle');
    } else if (preferencesStatus === 'unavailable' && !profile) {
      setError(t('loadError'));
      setStatus('idle');
    }
  }, [form, locale, preferencesStatus, profile, t]);

  useEffect(() => {
    setForm((current) =>
      current && current.appearance !== preferences.appearance
        ? { ...current, appearance: preferences.appearance }
        : current,
    );
  }, [preferences.appearance]);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => (current ? { ...current, [field]: value } : current));
    setStatus('idle');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;

    setError(null);
    setStatus('saving');

    try {
      const nextProfile = await saveProfileChanges({
        appearance: form.appearance,
        dateFormat: form.dateFormat,
        distanceUnit: form.distanceUnit,
        displayName: form.displayName.trim() || null,
        homeCurrencyCode: form.homeCurrencyCode.trim().toUpperCase() || null,
        homeLocation: form.homeLocation.trim() || null,
        temperatureUnit: form.temperatureUnit,
        timeFormat: form.timeFormat,
      });
      setForm(getFormState(nextProfile, locale));
      setStatus('saved');
    } catch {
      setError(t('saveError'));
      setStatus('idle');
    }
  }

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !profile) return;

    setError(null);
    setPhotoBusy(true);

    try {
      const { path, supabase } = await uploadProfilePhoto(file);
      const previousPath = profile.avatarPath;
      await saveProfileChanges({ avatarPath: path });
      if (previousPath) await removeProfilePhoto(supabase, previousPath);
    } catch (photoError) {
      setError(
        photoError instanceof Error && photoError.message === 'invalid_profile_photo'
          ? t('photoInvalid')
          : t('photoError'),
      );
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handlePhotoRemove() {
    if (!profile?.avatarPath) return;

    setError(null);
    setPhotoBusy(true);

    try {
      await saveProfileChanges({ avatarPath: null });
      const supabase = (await import('@/lib/supabase/client')).createBrowserSupabaseClient();
      if (supabase) await removeProfilePhoto(supabase, profile.avatarPath);
    } catch {
      setError(t('photoError'));
    } finally {
      setPhotoBusy(false);
    }
  }

  if (!form) {
    return (
      <PageState
        headingLevel={2}
        icon={error ? <CircleAlert aria-hidden="true" /> : undefined}
        kind={error ? 'error' : 'loading'}
        title={error ?? t('loading')}
      />
    );
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      {error ? (
        <Alert role="alert" variant="destructive">
          <AlertDescription className="text-destructive">{error}</AlertDescription>
        </Alert>
      ) : null}

      {appearanceSaveError ? (
        <Alert role="status" variant="destructive">
          <AlertDescription className="text-destructive">{t('appearanceUnsaved')}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="gap-0 py-0">
        <FieldSet className="gap-5 p-5 sm:p-6">
          <FieldLegend className="text-lg leading-6 font-semibold tracking-tight">
            {t('profileSection')}
          </FieldLegend>
          <div className="grid gap-6 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="profile-display-name">{t('displayName')}</FieldLabel>
              <Input
                aria-describedby="profile-display-name-hint"
                id="profile-display-name"
                maxLength={100}
                onChange={(event) => updateField('displayName', event.target.value)}
                value={form.displayName}
              />
              <FieldDescription id="profile-display-name-hint">
                {t('displayNameHint')}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-home-location">{t('homeLocation')}</FieldLabel>
              <Input
                aria-describedby="profile-home-location-hint"
                id="profile-home-location"
                maxLength={200}
                onChange={(event) => updateField('homeLocation', event.target.value)}
                value={form.homeLocation}
              />
              <FieldDescription id="profile-home-location-hint">
                {t('homeLocationHint')}
              </FieldDescription>
            </Field>
            <Field className="sm:max-w-xs">
              <FieldLabel htmlFor="profile-home-currency">{t('homeCurrency')}</FieldLabel>
              <CurrencyCombobox
                aria-describedby="profile-home-currency-hint"
                aria-label={t('homeCurrency')}
                id="profile-home-currency"
                onValueChange={(value) => updateField('homeCurrencyCode', value)}
                placeholder={t('homeCurrencyPlaceholder')}
                value={form.homeCurrencyCode}
              />
              <FieldDescription id="profile-home-currency-hint">
                {t('homeCurrencyHint')}
              </FieldDescription>
            </Field>
          </div>
        </FieldSet>

        <FieldSet className="gap-5 border-t p-5 sm:p-6">
          <FieldLegend className="text-lg leading-6 font-semibold tracking-tight">
            {t('photoSection')}
          </FieldLegend>
          <div className="flex flex-wrap items-center gap-5">
            <div className="flex size-20 items-center justify-center overflow-hidden rounded-full bg-secondary text-2xl font-semibold text-secondary-foreground">
              {profile?.avatarUrl ? (
                <Image
                  alt={t('photoAlt')}
                  className="size-full object-cover"
                  height={80}
                  src={profile.avatarUrl}
                  unoptimized
                  width={80}
                />
              ) : (
                form.displayName.slice(0, 1).toUpperCase() || '?'
              )}
            </div>
            <div className="space-y-2">
              {/* The input this wraps is `sr-only`, so it is focusable but has
                  no ring of its own to show; the label wears it instead. */}
              <label
                className={cn(
                  buttonVariants({ size: 'default' }),
                  'focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40',
                  photoBusy ? 'pointer-events-none opacity-50' : 'cursor-pointer',
                )}
              >
                <span aria-disabled={photoBusy}>
                  {profile?.avatarPath ? t('changePhoto') : t('choosePhoto')}
                </span>
                <Input
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  disabled={photoBusy}
                  onChange={handlePhotoChange}
                  type="file"
                />
              </label>
              {profile?.avatarPath ? (
                <Button
                  disabled={photoBusy}
                  onClick={handlePhotoRemove}
                  type="button"
                  variant="outline"
                >
                  {t('removePhoto')}
                </Button>
              ) : null}
              <p className="text-xs text-muted-foreground">{t('photoHint')}</p>
            </div>
          </div>
        </FieldSet>

        <FieldSet className="gap-5 border-t p-5 sm:p-6">
          <FieldLegend className="text-lg leading-6 font-semibold tracking-tight">
            {t('preferencesSection')}
          </FieldLegend>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <SelectField
              label={t('distanceUnit')}
              onChange={(value) => updateField('distanceUnit', value as FormState['distanceUnit'])}
              options={[
                ['km', t('kilometers')],
                ['mi', t('miles')],
              ]}
              value={form.distanceUnit}
            />
            <SelectField
              label={t('temperatureUnit')}
              onChange={(value) =>
                updateField('temperatureUnit', value as FormState['temperatureUnit'])
              }
              options={[
                ['celsius', t('celsius')],
                ['fahrenheit', t('fahrenheit')],
              ]}
              value={form.temperatureUnit}
            />
            <SelectField
              label={t('timeFormat')}
              onChange={(value) => updateField('timeFormat', value as FormState['timeFormat'])}
              options={[
                ['12h', t('hour12')],
                ['24h', t('hour24')],
              ]}
              value={form.timeFormat}
            />
            <SelectField
              label={t('dateFormat')}
              onChange={(value) => updateField('dateFormat', value as FormState['dateFormat'])}
              options={[
                ['mdy', t('monthDayYear')],
                ['dmy', t('dayMonthYear')],
                ['ymd', t('yearMonthDay')],
              ]}
              value={form.dateFormat}
            />
            <SelectField
              label={t('appearance')}
              onChange={(value) => {
                const appearance = value as FormState['appearance'];
                updateField('appearance', appearance);
                setAppearance(appearance);
              }}
              options={[
                ['light', t('light')],
                ['dark', t('dark')],
              ]}
              value={form.appearance}
            />
          </div>
        </FieldSet>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={status === 'saving'} type="submit">
          {status === 'saving' ? t('saving') : t('save')}
        </Button>
        {status === 'saved' ? (
          <span className="text-sm text-status-success" role="status">
            {t('saved')}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function SelectField({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: [string, string][];
  value: string;
}) {
  const id = useId();

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        onValueChange={(nextValue) => {
          if (nextValue) onChange(nextValue);
        }}
        value={value}
      >
        <SelectTrigger className="w-full" id={id}>
          <SelectValue>
            {(selectedValue) => options.find(([option]) => option === selectedValue)?.[1] ?? ''}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map(([option, optionLabel]) => (
            <SelectItem key={option} value={option}>
              {optionLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
