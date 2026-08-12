import { ExpensesManager } from '@/components/expenses-manager';

export default async function ExpensesPage({
  params,
}: Readonly<{ params: Promise<{ tripId: string }> }>) {
  const { tripId } = await params;
  return <ExpensesManager tripId={tripId} />;
}
