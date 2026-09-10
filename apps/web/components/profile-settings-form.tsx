'use client';

import Image from 'next/image';
import { CircleAlert, Palette, SlidersHorizontal, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';

import { PageState } from '@/components/page-state';
import { usePreferences } from '@/components/preferences-provider';
import { CountryCombobox } from '@/components/country-combobox';
import { CurrencyCombobox } from '@/components/currency-combobox';
import { EditorialSection } from '@/components/editorial-section';
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
import { removeProfilePhoto, uploadProfilePhoto } from '@/lib/profile/api';
import {
  getProfileSettingsFormState,
  haveSavedProfileSettingsChanged,
  normalizeSavedProfileSettings,
  type ProfileSettingsFormState,
  type SavedProfileSettings,
} from '@/lib/profile/settings-form';
import { cn } from '@/lib/utils';

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
  const [form, setForm] = useState<ProfileSettingsFormState | null>(null);
  const [savedBaseline, setSavedBaseline] = useState<SavedProfileSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'saved'>('loading');
  const [photoBusy, setPhotoBusy] = useState(false);

  useEffect(() => {
    if (profile && !form) {
      const initialForm = getProfileSettingsFormState(profile, locale);
      setForm(initialForm);
      setSavedBaseline(normalizeSavedProfileSettings(initialForm));
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

  function updateField<K extends keyof ProfileSettingsFormState>(
    field: K,
    value: ProfileSettingsFormState[K],
  ) {
    setForm((current) => (current ? { ...current, [field]: value } : current));
    setStatus('idle');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || !savedBaseline || !haveSavedProfileSettingsChanged(form, savedBaseline)) return;

    setError(null);
    setStatus('saving');

    try {
      const nextProfile = await saveProfileChanges({
        dateFormat: form.dateFormat,
        distanceUnit: form.distanceUnit,
        displayName: form.displayName.trim() || null,
        homeCountryCode: form.homeCountryCode.trim().toUpperCase() || null,
        homeCurrencyCode: form.homeCurrencyCode.trim().toUpperCase() || null,
        temperatureUnit: form.temperatureUnit,
        timeFormat: form.timeFormat,
      });
      const savedForm = getProfileSettingsFormState(nextProfile, locale);
      setForm((current) =>
        current ? { ...savedForm, appearance: current.appearance } : savedForm,
      );
      setSavedBaseline(normalizeSavedProfileSettings(savedForm));
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

  const isDirty = savedBaseline ? haveSavedProfileSettingsChanged(form, savedBaseline) : false;

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

      <Card
        className="scroll-mt-[calc(var(--safe-top)+var(--header-height)+1rem)] gap-0 py-0"
        id="profile"
      >
        <EditorialSection
          className="p-5 sm:p-6"
          description={t('profileSectionDescription')}
          headingId="profile-settings-heading"
          icon={<UserRound aria-hidden="true" />}
          title={t('profileSection')}
        >
          <FieldSet className="mt-6 gap-6">
            <FieldLegend className="sr-only">{t('profileSection')}</FieldLegend>
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
                <FieldLabel htmlFor="profile-home-country">{t('homeCountry')}</FieldLabel>
                <CountryCombobox
                  aria-describedby="profile-home-country-hint"
                  aria-label={t('homeCountry')}
                  id="profile-home-country"
                  onValueChange={(value) => updateField('homeCountryCode', value)}
                  placeholder={t('homeCountryPlaceholder')}
                  value={form.homeCountryCode}
                />
                <FieldDescription id="profile-home-country-hint">
                  {t('homeCountryHint')}
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

            <div className="border-t border-border-subtle pt-5">
              <p className="text-sm font-medium text-foreground">{t('photoSection')}</p>
              <div className="mt-3 flex flex-wrap items-center gap-4 sm:gap-5">
                <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-2xl font-semibold text-secondary-foreground">
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
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {/* The input is screen-reader only, so its label carries the focus ring. */}
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
                        className="sr-only size-px!"
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
                  </div>
                  <p className="text-xs text-muted-foreground">{t('photoHint')}</p>
                </div>
              </div>
            </div>
          </FieldSet>
        </EditorialSection>
      </Card>

      <Card
        className="scroll-mt-[calc(var(--safe-top)+var(--header-height)+1rem)] gap-0 py-0"
        id="travel-preferences"
      >
        <EditorialSection
          className="p-5 sm:p-6"
          description={t('preferencesSectionDescription')}
          headingId="travel-preferences-heading"
          icon={<SlidersHorizontal aria-hidden="true" />}
          title={t('preferencesSection')}
        >
          <FieldSet className="mt-6 gap-6">
            <FieldLegend className="sr-only">{t('preferencesSection')}</FieldLegend>
            <div className="grid gap-6 sm:grid-cols-2">
              <SelectField
                label={t('distanceUnit')}
                onChange={(value) =>
                  updateField('distanceUnit', value as ProfileSettingsFormState['distanceUnit'])
                }
                options={[
                  ['km', t('kilometers')],
                  ['mi', t('miles')],
                ]}
                value={form.distanceUnit}
              />
              <SelectField
                label={t('temperatureUnit')}
                onChange={(value) =>
                  updateField(
                    'temperatureUnit',
                    value as ProfileSettingsFormState['temperatureUnit'],
                  )
                }
                options={[
                  ['celsius', t('celsius')],
                  ['fahrenheit', t('fahrenheit')],
                ]}
                value={form.temperatureUnit}
              />
              <SelectField
                label={t('timeFormat')}
                onChange={(value) =>
                  updateField('timeFormat', value as ProfileSettingsFormState['timeFormat'])
                }
                options={[
                  ['12h', t('hour12')],
                  ['24h', t('hour24')],
                ]}
                value={form.timeFormat}
              />
              <SelectField
                label={t('dateFormat')}
                onChange={(value) =>
                  updateField('dateFormat', value as ProfileSettingsFormState['dateFormat'])
                }
                options={[
                  ['mdy', t('monthDayYear')],
                  ['dmy', t('dayMonthYear')],
                  ['ymd', t('yearMonthDay')],
                ]}
                value={form.dateFormat}
              />
            </div>
          </FieldSet>
        </EditorialSection>
      </Card>

      <Card
        className="scroll-mt-[calc(var(--safe-top)+var(--header-height)+1rem)] gap-0 py-0"
        id="appearance"
      >
        <EditorialSection
          className="p-5 sm:p-6"
          description={t('appearanceSectionDescription')}
          headingId="appearance-settings-heading"
          icon={<Palette aria-hidden="true" />}
          title={t('appearanceSection')}
        >
          <FieldSet className="mt-6 max-w-sm">
            <FieldLegend className="sr-only">{t('appearanceSection')}</FieldLegend>
            <SelectField
              label={t('appearance')}
              onChange={(value) => {
                const appearance = value as ProfileSettingsFormState['appearance'];
                setForm((current) => (current ? { ...current, appearance } : current));
                setAppearance(appearance);
              }}
              options={[
                ['light', t('light')],
                ['dark', t('dark')],
              ]}
              value={form.appearance}
            />
          </FieldSet>
        </EditorialSection>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={status === 'saving' || !isDirty} type="submit">
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
