import { CalendarDays, Clock3, Map, MapPinned } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { PageState } from '@/components/page-state';

export type TripModeView = 'map' | 'now' | 'today' | 'trip';

const viewIcons = {
  map: Map,
  now: Clock3,
  today: CalendarDays,
  trip: MapPinned,
} as const;

export async function TripModeViewContent({ view }: Readonly<{ view: TripModeView }>) {
  const t = await getTranslations('tripMode.views');
  const Icon = viewIcons[view];

  return (
    <PageState
      description={t(`${view}.description`)}
      headingLevel={2}
      icon={<Icon aria-hidden="true" />}
      title={t(`${view}.title`)}
    />
  );
}
