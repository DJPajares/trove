import { ReservationsManager } from '@/components/reservations-manager';

export default async function ReservationsPage({
  params,
}: Readonly<{ params: Promise<{ tripId: string }> }>) {
  const { tripId } = await params;
  return <ReservationsManager tripId={tripId} />;
}
