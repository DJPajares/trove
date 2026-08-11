'use client';

import Image from 'next/image';
import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useEffect, useId, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';

import { PageState } from '@/components/page-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  fetchProfile,
  removeProfilePhoto,
  saveProfile,
  type Profile,
  uploadProfilePhoto,
} from '@/lib/profile/api';
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
  const { setTheme } = useTheme();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'saved'>('loading');
  const [photoBusy, setPhotoBusy] = useState(false);

  useEffect(() => {
    let active = true;

    void fetchProfile()
      .then(({ profile: nextProfile }) => {
        if (!active) return;
        setProfile(nextProfile);
        setForm(getFormState(nextProfile, locale));
        if (nextProfile.appearance) setTheme(nextProfile.appearance);
        setStatus('idle');
      })
      .catch(() => {
        if (!active) return;
        setError(t('loadError'));
        setStatus('idle');
      });

    return () => {
      active = false;
    };
  }, [locale, setTheme, t]);

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
      const { profile: nextProfile } = await saveProfile({
        appearance: form.appearance,
        dateFormat: form.dateFormat,
        distanceUnit: form.distanceUnit,
        displayName: form.displayName.trim() || null,
        homeCurrencyCode: form.homeCurrencyCode.trim().toUpperCase() || null,
        homeLocation: form.homeLocation.trim() || null,
        temperatureUnit: form.temperatureUnit,
        timeFormat: form.timeFormat,
      });
      setProfile(nextProfile);
      setForm(getFormState(nextProfile, locale));
      setTheme(form.appearance);
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
      const { profile: nextProfile } = await saveProfile({ avatarPath: path });
      setProfile(nextProfile);
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
      const { profile: nextProfile } = await saveProfile({ avatarPath: null });
      const supabase = (await import('@/lib/supabase/client')).createBrowserSupabaseClient();
      setProfile(nextProfile);
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

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t('profileSection')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
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
            <Input
              aria-describedby="profile-home-currency-hint"
              autoCapitalize="characters"
              className="uppercase"
              id="profile-home-currency"
              maxLength={3}
              onChange={(event) =>
                updateField('homeCurrencyCode', event.target.value.toUpperCase())
              }
              value={form.homeCurrencyCode}
            />
            <FieldDescription id="profile-home-currency-hint">
              {t('homeCurrencyHint')}
            </FieldDescription>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t('photoSection')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-5">
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
            <label
              className={cn(
                buttonVariants({ size: 'default' }),
                photoBusy ? 'pointer-events-none opacity-50' : 'cursor-pointer',
              )}
            >
              <span aria-disabled={photoBusy}>
                {profile?.avatarPath ? t('changePhoto') : t('choosePhoto')}
              </span>
              <input
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t('preferencesSection')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
            onChange={(value) => updateField('appearance', value as FormState['appearance'])}
            options={[
              ['system', t('system')],
              ['light', t('light')],
              ['dark', t('dark')],
            ]}
            value={form.appearance}
          />
        </CardContent>
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
      <NativeSelect
        className="w-full"
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map(([option, optionLabel]) => (
          <NativeSelectOption key={option} value={option}>
            {optionLabel}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
}
