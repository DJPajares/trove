import { ExpensesManager } from '@/components/expenses-manager';

export default async function ExpensesPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{ create?: string; date?: string; itineraryItemId?: string }>;
}>) {
  const [{ tripId }, query] = await Promise.all([params, searchParams]);
  const quickAdd =
    query.create === '1'
      ? { itineraryItemId: query.itineraryItemId, localDate: query.date }
      : undefined;

  return <ExpensesManager quickAdd={quickAdd} tripId={tripId} />;
}
