import { TripMemoriesManager } from '@/components/trip-memories-manager';

export default async function TripMemoriesPage({
  params,
}: Readonly<{ params: Promise<{ tripId: string }> }>) {
  const { tripId } = await params;
  return <TripMemoriesManager tripId={tripId} />;
}
