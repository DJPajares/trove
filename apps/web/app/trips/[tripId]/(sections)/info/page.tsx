import { TripInfoManager } from '@/components/trip-info-manager';

export default async function TripInfoPage({
  params,
}: Readonly<{ params: Promise<{ tripId: string }> }>) {
  const { tripId } = await params;
  return <TripInfoManager tripId={tripId} />;
}
