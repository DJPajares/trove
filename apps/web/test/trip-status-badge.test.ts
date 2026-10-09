import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import { TripStatusBadge } from '@/components/trip-status-badge';
import type { Trip } from '@/lib/trips/api';
import messages from '@/messages/en.json';

test.each<{
  lifecycle: Trip['lifecycle'];
  readiness: Trip['planningReadiness'];
  label: string;
}>([
  { lifecycle: 'planning', readiness: 'in_progress', label: 'Planning' },
  { lifecycle: 'planning', readiness: 'ready', label: 'Ready' },
  { lifecycle: 'active', readiness: 'in_progress', label: 'Travelling now' },
  { lifecycle: 'active', readiness: 'ready', label: 'Travelling now' },
  { lifecycle: 'completed', readiness: 'in_progress', label: 'Completed' },
  { lifecycle: 'completed', readiness: 'ready', label: 'Completed' },
])('shows one status for $lifecycle / $readiness', ({ lifecycle, readiness, label }) => {
  for (const tone of ['default', 'onMedia'] as const) {
    const markup = renderToStaticMarkup(
      createElement(NextIntlClientProvider, {
        locale: 'en',
        messages,
        timeZone: 'UTC',
        children: createElement(TripStatusBadge, { lifecycle, readiness, tone }),
      }),
    );

    expect(markup.match(/data-slot="badge"/g)).toHaveLength(1);
    expect(markup.replace(/<[^>]*>/g, '')).toBe(label);
  }
});
