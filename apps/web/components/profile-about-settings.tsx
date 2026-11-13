'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, Image as ImageIcon, Plus, X } from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';

import { EditorialSection } from '@/components/editorial-section';
import { usePreferences } from '@/components/preferences-provider';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { queryKeys } from '@/lib/query/keys';
import { fetchTrips } from '@/lib/trips/api';
import { cn } from '@/lib/utils';

export const BIO_LIMIT = 160;
export const TRAVEL_STYLE_LIMIT = 6;
export const TRAVEL_STYLE_LENGTH = 32;
const COVER_CHOICES = 24;

/**
 * What the traveller says about themselves on their profile: a line or two, a
 * few tags for how they travel, and which of their own Memory photos leads the
 * page. It saves on its own, apart from the details and preferences above it,
 * because none of it changes how a trip is planned.
 */
export function ProfileAboutSettings() {
  const t = useTranslations('profile.about');
  const { profile, saveProfileChanges } = usePreferences();
  const bioId = useId();
  const styleId = useId();
  const [bio, setBio] = useState('');
  const [styles, setStyles] = useState<string[]>([]);
  const [draftStyle, setDraftStyle] = useState('');
  const [coverId, setCoverId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Every Memory photo the trips list already carries, newest trips first.
  const tripsQuery = useQuery({ queryFn: () => fetchTrips(), queryKey: queryKeys.trips() });
  const photos = useMemo(
    () =>
      (tripsQuery.data?.trips ?? [])
        .filter((trip) => trip.lifecycle === 'completed' && !trip.archivedAt)
        .toSorted((left, right) => right.endDate.localeCompare(left.endDate))
        .flatMap((trip) =>
          (trip.memoryPhotos ?? [])
            .filter((photo) => !photo.contentType.includes('heic'))
            .map((photo) => ({ ...photo, tripName: trip.name })),
        )
        .slice(0, COVER_CHOICES),
    [tripsQuery.data?.trips],
  );

  const saved = useMemo(
    () => ({
      bio: profile?.bio ?? '',
      coverId: profile?.coverPhoto?.id ?? null,
      styles: profile?.travelStyles ?? [],
    }),
    [profile?.bio, profile?.coverPhoto?.id, profile?.travelStyles],
  );

  useEffect(() => {
    setBio(saved.bio);
    setStyles(saved.styles);
    setCoverId(saved.coverId);
  }, [saved]);

  const dirty =
    bio.trim() !== saved.bio.trim() ||
    coverId !== saved.coverId ||
    styles.join('\n') !== saved.styles.join('\n');

  // The chosen cover may sit beyond the photos the trips list carries.
  const choices =
    profile?.coverPhoto && !photos.some(({ id }) => id === profile.coverPhoto?.id)
      ? [{ ...profile.coverPhoto, tripName: '' }, ...photos]
      : photos;

  function addStyle() {
    const value = draftStyle.trim().replace(/\s+/g, ' ').slice(0, TRAVEL_STYLE_LENGTH);
    if (!value) return;
    setStyles((current) =>
      current.length >= TRAVEL_STYLE_LIMIT ||
      current.some((style) => style.toLocaleLowerCase() === value.toLocaleLowerCase())
        ? current
        : [...current, value],
    );
    setDraftStyle('');
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setStatus('saving');
    try {
      await saveProfileChanges({
        bio: bio.trim() || null,
        coverMemoryPhotoId: coverId,
        travelStyles: styles,
      });
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }

  return (
    <form className="space-y-4" onSubmit={(event) => void save(event)}>
      <Card
        className="scroll-mt-[calc(var(--safe-top)+var(--header-height)+1rem)] gap-0 py-0"
        id="about"
      >
        <EditorialSection
          className="p-5 sm:p-6"
          description={t('description')}
          headingId="profile-about-heading"
          title={t('title')}
        >
          <FieldSet className="mt-6 gap-6">
            <FieldLegend className="sr-only">{t('title')}</FieldLegend>

            <Field>
              <FieldLabel htmlFor={bioId}>{t('bio')}</FieldLabel>
              <Textarea
                className="font-journal text-lg leading-snug"
                id={bioId}
                maxLength={BIO_LIMIT}
                onChange={(event) => setBio(event.target.value)}
                placeholder={t('bioPlaceholder')}
                rows={3}
                value={bio}
              />
              <FieldDescription className="tabular-nums">
                {t('bioCount', { count: bio.length, limit: BIO_LIMIT })}
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor={styleId}>{t('styles')}</FieldLabel>
              {styles.length ? (
                <ul className="flex flex-wrap gap-2">
                  {styles.map((style) => (
                    <li
                      className="inline-flex h-9 items-center gap-1 rounded-full bg-secondary ps-3.5 pe-1 text-sm font-medium text-secondary-foreground"
                      key={style}
                    >
                      {style}
                      <button
                        aria-label={t('removeStyle', { style })}
                        className="grid size-7 place-items-center rounded-full outline-none hover:bg-secondary-foreground/10 focus-visible:ring-3 focus-visible:ring-ring/40"
                        onClick={() =>
                          setStyles((current) => current.filter((item) => item !== style))
                        }
                        type="button"
                      >
                        <X aria-hidden="true" className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {styles.length < TRAVEL_STYLE_LIMIT ? (
                <div className="flex gap-2">
                  <Input
                    id={styleId}
                    maxLength={TRAVEL_STYLE_LENGTH}
                    onChange={(event) => setDraftStyle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      addStyle();
                    }}
                    placeholder={t('stylePlaceholder')}
                    value={draftStyle}
                  />
                  <Button
                    disabled={!draftStyle.trim()}
                    onClick={addStyle}
                    type="button"
                    variant="outline"
                  >
                    <Plus aria-hidden="true" data-icon="inline-start" />
                    {t('addStyle')}
                  </Button>
                </div>
              ) : null}
              <FieldDescription>{t('stylesHint', { limit: TRAVEL_STYLE_LIMIT })}</FieldDescription>
            </Field>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">{t('cover')}</legend>
              <p className="text-sm text-muted-foreground">
                {choices.length ? t('coverHint') : t('coverEmpty')}
              </p>
              {choices.length ? (
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  <li>
                    <button
                      aria-pressed={coverId === null}
                      className={cn(
                        'grid aspect-square w-full place-items-center gap-1 rounded-[var(--radius-lg)] border border-dashed border-border-strong p-2 text-center text-xs text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/40',
                        coverId === null &&
                          'border-solid border-brand text-foreground ring-2 ring-brand',
                      )}
                      onClick={() => setCoverId(null)}
                      type="button"
                    >
                      <ImageIcon aria-hidden="true" className="size-5" />
                      {t('coverAuto')}
                    </button>
                  </li>
                  {choices.map((photo) => (
                    <li key={photo.id}>
                      <button
                        aria-label={
                          photo.tripName
                            ? t('coverFrom', { trip: photo.tripName })
                            : t('coverCurrent')
                        }
                        aria-pressed={coverId === photo.id}
                        className={cn(
                          'relative block aspect-square w-full overflow-hidden rounded-[var(--radius-lg)] outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                          coverId === photo.id && 'ring-3 ring-brand',
                        )}
                        onClick={() => setCoverId(photo.id)}
                        type="button"
                      >
                        <Image
                          alt=""
                          className="size-full object-cover"
                          height={160}
                          src={photo.url}
                          unoptimized
                          width={160}
                        />
                        {coverId === photo.id ? (
                          <span className="absolute end-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-brand text-primary-foreground">
                            <Check aria-hidden="true" className="size-3.5" />
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </fieldset>
          </FieldSet>
        </EditorialSection>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={status === 'saving' || !dirty} type="submit">
          {status === 'saving' ? t('saving') : t('save')}
        </Button>
        {status === 'saved' && !dirty ? (
          <span className="text-sm text-status-success" role="status">
            {t('saved')}
          </span>
        ) : null}
        {status === 'error' ? (
          <span className="text-sm text-destructive" role="alert">
            {t('error')}
          </span>
        ) : null}
      </div>
    </form>
  );
}
