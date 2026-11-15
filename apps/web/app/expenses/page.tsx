import { Suspense } from 'react';

import { ExpensesPage } from '@/components/expenses/expenses-page';

/** The switcher reads its trip from the address, which needs a boundary. */
export default function ExpensesRoute() {
  return (
    <Suspense>
      <ExpensesPage />
    </Suspense>
  );
}
