import { CircleCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import type { Trip } from '@/lib/trips/api';
import { cn } from '@/lib/utils';

type TripReadinessBadgeProps = {
  className?: string;
  lifecycle: Trip['lifecycle'];
  readiness: Trip['planningReadiness'];
  tone?: 'default' | 'onMedia';
};

/**
 * The traveller's own "this plan is settled" marker.
 *
 * Only a trip still being planned can carry it: once a trip is under way or
 * finished, whether its plan was ever declared ready is history, and a second
 * chip beside the lifecycle one would say nothing the dates do not. In
 * progress is the resting state and shows nothing at all - a marker that
 * appears on every trip marks none of them.
 */
export function TripReadinessBadge({
  className,
  lifecycle,
  readiness,
  tone = 'default',
}: Readonly<TripReadinessBadgeProps>) {
  const t = useTranslations('trips');

  if (lifecycle !== 'planning' || readiness !== 'ready') return null;

  return (
    <Badge
      className={cn(
        tone === 'onMedia' &&
          'border border-white/22 bg-status-success/85 text-white shadow-sm backdrop-blur-sm',
        className,
      )}
      variant="success"
    >
      <CircleCheck aria-hidden="true" />
      {t('readinessState.ready')}
    </Badge>
  );
}
