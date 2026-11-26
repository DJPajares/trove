'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Ellipsis, Plus } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  ATLAS_LICENCE,
  wikivoyageArticleUrl,
  wikivoyageHistoryUrl,
  type AtlasBlock,
  type AtlasListing,
  type AtlasListingKind,
  type AtlasSection,
} from '@trove/types';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollShadow } from '@/components/ui/scroll-shadow';
import { useAtlasTripPicks } from '@/hooks/use-atlas-trip-picks';
import { saveAtlasListing } from '@/lib/atlas/api';
import type { SavedPlacesResponse } from '@/lib/saved/api';
import { CARD_LIST_SECTIONS, extractListCards, type AtlasCardItem } from '@/lib/atlas/cards';
import { readingMinutes } from '@/lib/atlas/format';
import { ATLAS_MAX_TRIP_PICKS, atlasPickId, type AtlasTripPickInput } from '@/lib/atlas/picks';
import * as Icons from '@/lib/icons';
import { queryKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils';

export type AtlasPickContext = {
  countryCode: string;
  countryName: string;
  destinationName: string;
  destinationSlug: string;
  guideTitle: string;
};

const PICKABLE_CARD_SECTION_KINDS: Partial<Record<string, AtlasListingKind>> = {
  buy: 'buy',
  do: 'do',
  drink: 'drink',
  eat: 'eat',
  see: 'see',
  sleep: 'sleep',
};

/** Practicality chapters that stand apart as tinted field notes. */
const FIELD_NOTE_SECTIONS = new Set(['stay-safe', 'respect', 'stay-healthy']);

export function sectionWords(section: AtlasSection) {
  const text = section.blocks
    .map((block) =>
      block.type === 'list'
        ? block.items.join(' ')
        : block.type === 'listing'
          ? `${block.listing.name} ${block.listing.content ?? ''}`
          : block.text,
    )
    .join(' ');
  return text.split(/\s+/).filter(Boolean).length;
}

export function chapterNumber(index: number) {
  return String(index + 1).padStart(2, '0');
}

type BlockGroup =
  | { kind: 'listings'; items: AtlasListing[] }
  | { kind: 'cards'; items: AtlasCardItem[]; label: string }
  | { kind: 'phrases'; items: AtlasCardItem[] }
  | { kind: 'block'; block: AtlasBlock };

/**
 * Groups consecutive listing blocks into 2-column grids and turns structured
 * "Name — description" lists in highlight/food/region chapters into field-guide
 * cards (or tap-to-reveal phrase cards in Talk).
 */
export function groupSectionBlocks(section: AtlasSection): BlockGroup[] {
  const groups: BlockGroup[] = [];
  const cardEligible = CARD_LIST_SECTIONS.has(section.id);
  const isTalk = section.id === 'talk';

  for (const block of section.blocks) {
    if (block.type === 'listing') {
      const previous = groups.at(-1);
      if (previous?.kind === 'listings') previous.items.push(block.listing);
      else groups.push({ kind: 'listings', items: [block.listing] });
    } else if (block.type === 'list' && (cardEligible || isTalk)) {
      const cards = extractListCards(block.items);
      if (cards) {
        groups.push(
          isTalk
            ? { kind: 'phrases', items: cards }
            : { kind: 'cards', items: cards, label: section.title },
        );
      } else {
        groups.push({ kind: 'block', block });
      }
    } else {
      groups.push({ kind: 'block', block });
    }
  }
  return groups;
}

export function sectionHasCards(section: AtlasSection) {
  return groupSectionBlocks(section).some(
    (group) => group.kind === 'listings' || group.kind === 'cards' || group.kind === 'phrases',
  );
}

/** The opening sentence set large in the journal serif; the rest with an editorial drop cap. */
export function GuideLead({ paragraphs }: Readonly<{ paragraphs: string[] }>) {
  const [first = '', ...rest] = paragraphs.slice(0, 3);
  const end = first.search(/[.!?](\s|$)/);
  const opening = end > 0 ? first.slice(0, end + 1) : first;
  const remainder = [first.slice(opening.length).trim(), ...rest].filter(Boolean);
  return (
    <div className="flex flex-col gap-4">
      <p className="font-journal text-[1.625rem] leading-snug text-foreground italic sm:text-[1.875rem]">
        {opening}
      </p>
      {remainder.map((paragraph, index) => (
        <p
          className={cn(
            'text-base leading-[1.75] text-muted-foreground',
            index === 0 &&
              'first-letter:float-left first-letter:me-2 first-letter:pt-1 first-letter:font-journal first-letter:text-[3rem] first-letter:leading-[0.82] first-letter:text-foreground',
          )}
          key={index}
        >
          {paragraph}
        </p>
      ))}
    </div>
  );
}

/** Mobile chapter jump strip + numbered editorial chapters shared by country and destination guides. */
export function GuideChapters({
  isSectionOpen,
  onOpenSection,
  onToggleSection,
  pickContext,
  sections,
}: Readonly<{
  isSectionOpen: (id: string) => boolean;
  onOpenSection: (id: string) => void;
  onToggleSection: (id: string, open: boolean) => void;
  pickContext?: AtlasPickContext;
  sections: readonly AtlasSection[];
}>) {
  const g = useTranslations('atlas.guide');
  const { picks, togglePick } = useAtlasTripPicks();
  const pickedIds = new Set(picks.map((pick) => pick.id));
  const atLimit = picks.length >= ATLAS_MAX_TRIP_PICKS;

  if (!sections.length) return null;

  return (
    <>
      <ScrollShadow
        aria-label={g('sections')}
        className="interaction-scrollbar sticky top-[calc(var(--safe-top)+0.5rem)] z-10 -mx-[var(--gutter-inline-start)] flex gap-2 bg-background/95 px-[var(--gutter-inline-start)] py-2 backdrop-blur md:top-[calc(var(--header-height)+0.5rem)] lg:hidden"
        orientation="horizontal"
        render={<nav />}
      >
        {sections.map((section, idx) => (
          <button
            className="min-h-10 shrink-0 rounded-full border border-border bg-card px-3.5 text-sm font-medium outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40"
            key={section.id}
            onClick={() => onOpenSection(section.id)}
            type="button"
          >
            <span className="me-1.5 font-mono text-xs text-muted-foreground">
              {chapterNumber(idx)}
            </span>
            {section.title}
          </button>
        ))}
      </ScrollShadow>

      <div className="space-y-8">
        {sections.map((section, idx) => {
          const isFieldNote = FIELD_NOTE_SECTIONS.has(section.id);
          const groups = groupSectionBlocks(section);
          return (
            <article
              className={cn(
                'scroll-mt-24 pt-6',
                idx === 0 ? 'border-t-2 border-foreground/75' : 'border-t border-border-subtle',
              )}
              id={`atlas-section-${section.id}`}
              key={section.id}
            >
              <Collapsible
                onOpenChange={(open) => onToggleSection(section.id, open)}
                open={isSectionOpen(section.id)}
              >
                <CollapsibleTrigger className="group flex w-full items-center justify-between gap-4 text-left text-foreground hover:text-foreground">
                  <span className="flex flex-col gap-0.5">
                    <span className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
                      {g('chapterMeta', {
                        number: chapterNumber(idx),
                        readingTime: g('readingTime', {
                          minutes: readingMinutes(sectionWords(section)),
                        }),
                      })}
                    </span>
                    <span className="font-journal text-[2rem] leading-tight font-normal sm:text-[2.25rem]">
                      {section.title}
                    </span>
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className="size-5 shrink-0 text-muted-foreground transition-transform duration-[var(--motion-standard)] group-data-[panel-open]:rotate-180 motion-reduce:transition-none"
                  />
                </CollapsibleTrigger>
                <CollapsiblePanel>
                  <div
                    className={cn(
                      'mt-5 flex flex-col gap-4',
                      isFieldNote &&
                        'rounded-[var(--radius-xl)] border border-border-subtle border-s-2 border-s-accent-strong bg-card p-5',
                    )}
                  >
                    {groups.map((group, groupIndex) =>
                      group.kind === 'listings' ? (
                        <div className="grid gap-3 sm:grid-cols-2" key={`listings-${groupIndex}`}>
                          {group.items.map((listing, listingIndex) => {
                            const pickInput: AtlasTripPickInput | null = pickContext
                              ? {
                                  address: listing.address,
                                  countryCode: pickContext.countryCode,
                                  countryName: pickContext.countryName,
                                  destinationName: pickContext.destinationName,
                                  destinationSlug: pickContext.destinationSlug,
                                  guideTitle: pickContext.guideTitle,
                                  kind: listing.kind,
                                  latitude: listing.latitude,
                                  longitude: listing.longitude,
                                  name: listing.name,
                                }
                              : null;
                            const picked = pickInput
                              ? pickedIds.has(atlasPickId(pickInput))
                              : false;
                            return (
                              <ListingCard
                                atLimit={atLimit}
                                key={listingIndex}
                                listing={listing}
                                saveInput={pickInput}
                                onTogglePick={pickInput ? () => togglePick(pickInput) : undefined}
                                picked={picked}
                              />
                            );
                          })}
                        </div>
                      ) : group.kind === 'cards' ? (
                        <div className="grid gap-3 sm:grid-cols-2" key={`cards-${groupIndex}`}>
                          {group.items.map((item, itemIndex) => {
                            const sectionKind = PICKABLE_CARD_SECTION_KINDS[section.id];
                            const pickInput: AtlasTripPickInput | null =
                              pickContext && sectionKind
                                ? {
                                    address: null,
                                    countryCode: pickContext.countryCode,
                                    countryName: pickContext.countryName,
                                    destinationName: pickContext.destinationName,
                                    destinationSlug: pickContext.destinationSlug,
                                    guideTitle: pickContext.guideTitle,
                                    kind: sectionKind,
                                    latitude: null,
                                    longitude: null,
                                    name: item.title,
                                  }
                                : null;
                            const picked = pickInput
                              ? pickedIds.has(atlasPickId(pickInput))
                              : false;
                            return (
                              <EntryCard
                                atLimit={atLimit}
                                item={item}
                                key={itemIndex}
                                label={group.label}
                                saveInput={pickInput}
                                onTogglePick={pickInput ? () => togglePick(pickInput) : undefined}
                                picked={picked}
                              />
                            );
                          })}
                        </div>
                      ) : group.kind === 'phrases' ? (
                        <div className="grid gap-3 sm:grid-cols-2" key={`phrases-${groupIndex}`}>
                          {group.items.map((item, itemIndex) => (
                            <PhraseCard item={item} key={itemIndex} />
                          ))}
                        </div>
                      ) : (
                        <GuideBlock block={group.block} key={`block-${groupIndex}`} />
                      ),
                    )}
                  </div>
                </CollapsiblePanel>
              </Collapsible>
            </article>
          );
        })}
      </div>
    </>
  );
}

export function GuideCreditFooter({
  climateYears,
  hasQuickFacts = false,
  title,
}: Readonly<{
  climateYears?: { from: number; to: number } | null;
  hasQuickFacts?: boolean;
  title: string;
}>) {
  const g = useTranslations('atlas.guide');
  return (
    <footer className="border-t border-border-subtle pt-5 text-sm leading-relaxed text-muted-foreground">
      <p>
        {g.rich('credit', {
          article: (chunks) => (
            <a className="underline" href={wikivoyageArticleUrl(title)}>
              {chunks}
            </a>
          ),
          authors: (chunks) => (
            <a className="underline" href={wikivoyageHistoryUrl(title)}>
              {chunks}
            </a>
          ),
          licence: (chunks) => (
            <a className="underline" href={ATLAS_LICENCE.url}>
              {chunks}
            </a>
          ),
          licenceName: ATLAS_LICENCE.name,
          title,
        })}
      </p>
      {climateYears ? <p className="mt-1">{g('climateCredit', climateYears)}</p> : null}
      {hasQuickFacts ? <p className="mt-1">{g('wikidataCredit')}</p> : null}
    </footer>
  );
}

function PickButton({
  atLimit,
  onClick,
  picked,
}: Readonly<{
  atLimit: boolean;
  onClick: () => void;
  picked: boolean;
}>) {
  const p = useTranslations('atlas.picks');
  const disabled = !picked && atLimit;
  return (
    <button
      aria-pressed={picked}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40',
        picked
          ? 'border-brand bg-brand text-primary-foreground'
          : 'border-border bg-background text-foreground hover:border-border-strong',
        disabled && 'cursor-not-allowed opacity-50',
      )}
      disabled={disabled}
      onClick={onClick}
      title={disabled ? p('limitReached', { max: ATLAS_MAX_TRIP_PICKS }) : undefined}
      type="button"
    >
      {picked ? (
        <Check aria-hidden="true" className="size-3.5" />
      ) : (
        <Plus aria-hidden="true" className="size-3.5" />
      )}
      {picked ? p('added') : p('add')}
    </button>
  );
}

function ListingCard({
  atLimit = false,
  listing,
  onTogglePick,
  picked = false,
  saveInput = null,
}: Readonly<{
  atLimit?: boolean;
  listing: AtlasListing;
  onTogglePick?: () => void;
  picked?: boolean;
  saveInput?: AtlasTripPickInput | null;
}>) {
  const g = useTranslations('atlas.guide');
  const save = useListingSave(saveInput);
  return (
    <article className="flex flex-col justify-between rounded-[var(--radius-xl)] border border-border-subtle bg-card p-4">
      <div>
        <span className="inline-flex rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">
          {g(`listing.${listing.kind}`)}
        </span>
        <h4 className="mt-2 font-journal text-[1.375rem] leading-snug font-normal text-foreground">
          {listing.name}
        </h4>
        {listing.alt ? <p className="mt-0.5 text-sm text-muted-foreground">{listing.alt}</p> : null}
        {listing.content ? (
          <p className="mt-2 text-sm leading-relaxed text-foreground/85">{listing.content}</p>
        ) : null}
      </div>
      {listing.address || onTogglePick || save ? (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border-subtle pt-2.5">
          <p className="min-w-0 truncate text-xs text-muted-foreground">{listing.address ?? ''}</p>
          <div className="flex shrink-0 items-center gap-1">
            {onTogglePick ? (
              <PickButton atLimit={atLimit} onClick={onTogglePick} picked={picked} />
            ) : null}
            {save ? <ListingMenu name={listing.name} save={save} /> : null}
          </div>
        </div>
      ) : null}
      {save ? <ListingSaveStatus save={save} /> : null}
    </article>
  );
}

function EntryCard({
  atLimit = false,
  item,
  label,
  onTogglePick,
  picked = false,
  saveInput = null,
}: Readonly<{
  atLimit?: boolean;
  item: AtlasCardItem;
  label: string;
  onTogglePick?: () => void;
  picked?: boolean;
  saveInput?: AtlasTripPickInput | null;
}>) {
  const save = useListingSave(saveInput);
  return (
    <article className="flex flex-col justify-between rounded-[var(--radius-xl)] border border-border-subtle bg-card p-4">
      <div>
        <span className="self-start rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">
          {label}
        </span>
        <h4 className="mt-2 font-journal text-[1.375rem] leading-snug font-normal text-foreground">
          {item.title}
        </h4>
        {item.detail ? (
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{item.detail}</p>
        ) : null}
      </div>
      {onTogglePick || save ? (
        <div className="mt-3 flex justify-end gap-1 border-t border-border-subtle pt-2.5">
          {onTogglePick ? (
            <PickButton atLimit={atLimit} onClick={onTogglePick} picked={picked} />
          ) : null}
          {save ? <ListingMenu name={item.title} save={save} /> : null}
        </div>
      ) : null}
      {save ? <ListingSaveStatus save={save} /> : null}
    </article>
  );
}

type ListingSave = ReturnType<typeof useListingSave>;

/**
 * Save on a listing (PRD 40.5): one explicit request that resolves this
 * listing alone into an ordinary Saved Place. Independent of trip picks.
 */
function useListingSave(input: AtlasTripPickInput | null) {
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [state, setState] = useState<'failed' | 'idle' | 'pending' | 'saved'>('idle');
  if (!input) return null;

  async function save(listing: AtlasTripPickInput) {
    setState('pending');
    try {
      const { savedPlace } = await saveAtlasListing({
        countryCode: listing.countryCode,
        destinationName: listing.destinationName,
        languageCode: locale,
        latitude: listing.latitude,
        longitude: listing.longitude,
        name: listing.name,
      });
      setState('saved');
      // Trove never refetches on mount, so the new Find goes straight into the
      // shared cache, as every other Save does.
      queryClient.setQueryData(
        queryKeys.savedPlaces(),
        (current: SavedPlacesResponse | undefined) =>
          current
            ? {
                ...current,
                savedPlaces: [
                  savedPlace,
                  ...current.savedPlaces.filter((entry) => entry.id !== savedPlace.id),
                ],
              }
            : current,
      );
    } catch {
      setState('failed');
    }
  }

  return {
    failed: state === 'failed',
    pending: state === 'pending',
    save: () => void save(input),
    saved: state === 'saved',
  };
}

function ListingMenu({ name, save }: Readonly<{ name: string; save: NonNullable<ListingSave> }>) {
  const g = useTranslations('atlas.guide');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={g('listingActions', { name })}
            className="text-muted-foreground"
            size="icon-sm"
            type="button"
            variant="ghost"
          />
        }
      >
        <Ellipsis aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem disabled={save.pending || save.saved} onClick={save.save}>
          <Icons.Saved aria-hidden="true" />
          {save.saved ? g('savedToFinds') : save.pending ? g('savingToFinds') : g('saveToFinds')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ListingSaveStatus({ save }: Readonly<{ save: NonNullable<ListingSave> }>) {
  const g = useTranslations('atlas.guide');
  return (
    <p aria-live="polite" className="text-xs" role="status">
      {save.pending ? (
        <span className="mt-2 block text-muted-foreground">{g('savingToFinds')}</span>
      ) : save.saved ? (
        <span className="mt-2 flex items-center gap-1.5 text-muted-foreground">
          <Check aria-hidden="true" className="size-3.5 text-brand" />
          {g('savedToFinds')}
          <Link
            className="font-semibold text-brand underline-offset-2 hover:underline"
            href="/saved"
          >
            {g('viewInFinds')}
          </Link>
        </span>
      ) : save.failed ? (
        <span className="mt-2 block text-destructive">{g('saveFailed')}</span>
      ) : null}
    </p>
  );
}

function PhraseCard({ item }: Readonly<{ item: AtlasCardItem }>) {
  const g = useTranslations('atlas.guide');
  const [revealed, setRevealed] = useState(false);

  return (
    <button
      aria-expanded={revealed}
      className="flex flex-col rounded-[var(--radius-xl)] border border-border-subtle bg-card p-4 text-left outline-none transition-colors hover:border-border-strong focus-visible:ring-3 focus-visible:ring-ring/40"
      onClick={() => setRevealed((open) => !open)}
      type="button"
    >
      <span className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
        {revealed ? g('tapToHide') : g('tapToReveal')}
      </span>
      <span className="mt-1.5 font-journal text-[1.375rem] leading-snug font-normal text-foreground">
        {item.title}
      </span>
      {revealed && item.detail ? (
        <span className="mt-2.5 border-t border-border-subtle pt-2.5 text-sm leading-relaxed font-medium text-brand">
          {item.detail}
        </span>
      ) : null}
    </button>
  );
}

function GuideBlock({ block }: Readonly<{ block: AtlasBlock }>) {
  switch (block.type) {
    case 'heading':
      return (
        <h3 className="pt-2 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          {block.text}
        </h3>
      );
    case 'paragraph':
      return <p className="text-base leading-[1.7] text-foreground/90">{block.text}</p>;
    case 'list':
      return (
        <ul className="flex list-disc flex-col gap-1.5 ps-5 text-base leading-[1.65] text-foreground/90 marker:text-muted-foreground">
          {block.items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      );
    case 'listing':
      return <ListingCard listing={block.listing} />;
  }
}
