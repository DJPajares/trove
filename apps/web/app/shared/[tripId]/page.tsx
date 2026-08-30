import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import { PublicItinerary } from '@/components/public-itinerary';
import { fetchPublicItinerary } from '@/lib/public-trip/api';

type SharedTripPageProps = { params: Promise<{ tripId: string }> };

export async function generateMetadata({ params }: SharedTripPageProps): Promise<Metadata> {
  const [{ tripId }, t] = await Promise.all([params, getTranslations('sharedTrip')]);
  const itinerary = await fetchPublicItinerary(tripId);

  return {
    description: t('description'),
    // A link is meant to be passed to the people on the trip, not found by
    // strangers. Sharing is not publishing, so nothing here asks to be indexed.
    robots: { follow: false, index: false },
    title: itinerary ? t('title', { trip: itinerary.trip.name }) : t('notFoundTitle'),
  };
}

/**
 * The one page in Trove that renders without an account.
 *
 * It lives at `/shared` rather than under `/trips` because `/trips` is one of the
 * four prefixes the Supabase proxy guards - a public page there would be
 * redirected to sign-in before it ever ran.
 */
export default async function SharedTripPage({ params }: SharedTripPageProps) {
  const [{ tripId }, locale] = await Promise.all([params, getLocale()]);
  const itinerary = await fetchPublicItinerary(tripId);

  // Private, never existed, or a malformed id - all the same answer, so the page
  // is no more of a tell than the endpoint behind it.
  if (!itinerary) notFound();

  return <PublicItinerary itinerary={itinerary} locale={locale} />;
}
