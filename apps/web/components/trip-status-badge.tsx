import { TripLifecycleBadge } from '@/components/trip-lifecycle-badge';
import { TripReadinessBadge } from '@/components/trip-readiness-badge';
import type { Trip } from '@/lib/trips/api';

/** One traveller-facing status: readiness before departure, lifecycle afterward. */
export function TripStatusBadge({
  className,
  lifecycle,
  readiness,
  tone = 'default',
}: Readonly<{
  className?: string;
  lifecycle: Trip['lifecycle'];
  readiness: Trip['planningReadiness'];
  tone?: 'default' | 'onMedia';
}>) {
  if (lifecycle === 'planning' && readiness === 'ready') {
    return (
      <TripReadinessBadge
        className={className}
        lifecycle={lifecycle}
        readiness={readiness}
        tone={tone}
      />
    );
  }

  return <TripLifecycleBadge className={className} lifecycle={lifecycle} tone={tone} />;
}
