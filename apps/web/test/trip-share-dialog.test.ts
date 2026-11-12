import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

import { TripShareDialog } from '@/components/trip-share-dialog';
import { queryKeys } from '@/lib/query/keys';
import type { Trip } from '@/lib/trips/api';
import messages from '@/messages/en.json';

// Render the real dialog contents without its browser-only portal. Native
// controls and localized content remain real; publishing is never requested.
vi.mock('@/components/ui/dialog', () => {
  const container = ({ children }: { children?: ReactNode }) =>
    createElement('div', null, children);
  return {
    Dialog: container,
    DialogContent: container,
    DialogHeader: container,
    DialogTitle: container,
    DialogDescription: container,
    DialogFooter: container,
    DialogClose: () => null,
  };
});

function renderShare(
  visibility: Trip['visibility'],
  options: { basedOn?: Trip['basedOn']; displayName?: string | null } = {},
) {
  // The owner's profile is already cached by the time a trip's menu opens.
  const queryClient = new QueryClient();
  queryClient.setQueryData(queryKeys.profile(), {
    profile: { displayName: options.displayName === undefined ? 'Ana' : options.displayName },
  });
  return renderToStaticMarkup(
    createElement(QueryClientProvider, {
      client: queryClient,
      children: createElement(NextIntlClientProvider, {
        locale: 'en',
        messages,
        timeZone: 'UTC',
        children: createElement(TripShareDialog, {
          onOpenChange: () => {},
          onTripChange: () => {},
          open: true,
          trip: { basedOn: options.basedOn, id: 'private-test-trip', visibility } as Trip,
        }),
      }),
    }),
  );
}

const textOf = (markup: string) =>
  markup
    .replace(/<[^>]*>/g, '')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"');

test('the owner learns their name is shown and credited on every copy before sharing', () => {
  const text = textOf(renderShare('private'));
  expect(text).toContain('Your display name, Ana.');
  expect(text).toContain('Every copy says “Based on Ana’s trip”.');

  const unnamed = textOf(renderShare('private', { displayName: null }));
  expect(unnamed).toContain('a Trove traveller');
  expect(unnamed).toContain('Add a display name');

  // Sharing a saved copy passes on the original creator's credit, not the sharer's.
  const copy = textOf(renderShare('private', { basedOn: { creatorName: 'Ben' } }));
  expect(copy).toContain('Every copy says “Based on Ben’s trip”.');
});

test('the private trip dialog discloses the complete public projection before enabling', () => {
  const markup = renderShare('private');
  const text = markup.replace(/<[^>]*>/g, '');
  for (const category of [
    'Trip name, description, countries, and dates',
    'Scheduled days’ dates, names, and notes',
    'Scheduled stops’ names, addresses or custom locations, dayparts, local start and end times, durations, and notes',
    'Custom Places and label-only items',
    'forward the link to others',
    'Reservations and documents',
    'Memories, ratings, media, and account details',
  ]) {
    expect(text).toContain(category);
  }
  expect(markup.indexOf('What the link shares')).toBeLessThan(markup.indexOf('role="switch"'));
  expect(markup).toContain('aria-checked="false"');
  expect(text).not.toContain('Copy link');
});

test('the sharing control describes its disclosure and keeps it available after publishing', () => {
  const markup = renderShare('public');
  const descriptionId = markup.match(/aria-describedby="([^"]+)"/)?.[1];
  expect(descriptionId).toBeTruthy();
  expect(markup).toContain(`id="${descriptionId}"`);
  expect(markup).toMatch(/<button[^>]*role="switch"/);
  expect(markup).toContain('aria-checked="true"');
  expect(markup).toContain('What the link shares');
  expect(markup).toContain('Copy link');
});
