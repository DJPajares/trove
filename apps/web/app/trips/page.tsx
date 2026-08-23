import { Suspense } from 'react';

import { TripsManager } from '@/components/trips-manager';

export default function TripsPage() {
  return (
    <Suspense>
      <TripsManager />
    </Suspense>
  );
}
