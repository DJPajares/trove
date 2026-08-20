import { Suspense } from 'react';

import { TripsManager } from '@/components/trips-manager';
import { isPlanScoreEnabled } from '@/lib/plan-score/config.server';

export default function TripsPage() {
  return (
    <Suspense>
      <TripsManager planScoreEnabled={isPlanScoreEnabled()} />
    </Suspense>
  );
}
