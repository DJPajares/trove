import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

import { TripShareDialog } from '@/components/trip-share-dialog';
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

function renderShare(visibility: Trip['visibility']) {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale: 'en',
      messages,
      timeZone: 'UTC',
      children: createElement(TripShareDialog, {
        onOpenChange: () => {},
        onTripChange: () => {},
        open: true,
        trip: { id: 'private-test-trip', visibility } as Trip,
      }),
    }),
  );
}

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
