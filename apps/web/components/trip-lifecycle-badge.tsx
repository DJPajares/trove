import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import type { Trip } from '@/lib/trips/api';
import { cn } from '@/lib/utils';

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

const onMediaLifecycleClasses: Record<Trip['lifecycle'], string> = {
  active: 'border-white/22 bg-brand text-white dark:text-primary-foreground',
  completed: 'border-white/22 bg-status-success text-white dark:text-primary-foreground',
  planning: 'border-white/22 bg-neutral-950/58 text-white',
};

type TripLifecycleBadgeProps = {
  className?: string;
  lifecycle: Trip['lifecycle'];
  tone?: 'default' | 'onMedia';
};

/** Where a trip is in its life, said the same way everywhere it is said. */
export function TripLifecycleBadge({
  className,
  lifecycle,
  tone = 'default',
}: Readonly<TripLifecycleBadgeProps>) {
  const t = useTranslations('trips');

  return (
    <Badge
      className={cn(
        tone === 'onMedia' && 'border shadow-sm backdrop-blur-sm',
        tone === 'onMedia' && onMediaLifecycleClasses[lifecycle],
        className,
      )}
      variant={lifecycleVariants[lifecycle]}
    >
      {t(`lifecycle.${lifecycle}`)}
    </Badge>
  );
}
