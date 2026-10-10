import { redirect } from 'next/navigation';
import { tripPlacesHref } from '@/lib/trip-places/navigation';

export default async function TripPlacesPage({
  params,
}: Readonly<{ params: Promise<{ tripId: string }> }>) {
  const { tripId } = await params;
  redirect(tripPlacesHref(tripId));
}
