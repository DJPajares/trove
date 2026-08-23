import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import type { Trip } from '@/lib/trips/api';

/**
 * A trip being travelled is the one thing on a screen that should read as
 * live, so it takes the brand tint; a finished trip is settled rather than
 * successful, and a planned one is simply not yet anything.
 */
const lifecycleVariants: Record<Trip['lifecycle'], 'brand' | 'muted' | 'success'> = {
  active: 'brand',
  completed: 'success',
  planning: 'muted',
};

type TripLifecycleBadgeProps = {
  className?: string;
  lifecycle: Trip['lifecycle'];
};

/** Where a trip is in its life, said the same way everywhere it is said. */
export function TripLifecycleBadge({ className, lifecycle }: Readonly<TripLifecycleBadgeProps>) {
  const t = useTranslations('trips');

  return (
    <Badge className={className} variant={lifecycleVariants[lifecycle]}>
      {t(`lifecycle.${lifecycle}`)}
    </Badge>
  );
}
