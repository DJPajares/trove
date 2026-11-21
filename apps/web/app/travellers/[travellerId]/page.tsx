import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import { PublicTravellerProfile } from '@/components/public-traveller-profile';
import { getAuthUserId } from '@/lib/auth/session';
import { fetchPublicTravellerProfile } from '@/lib/public-trip/api';

type TravellerPageProps = { params: Promise<{ travellerId: string }> };

export async function generateMetadata({ params }: TravellerPageProps): Promise<Metadata> {
  const [{ travellerId }, t] = await Promise.all([params, getTranslations('publicTraveller')]);
  const profile = await fetchPublicTravellerProfile(travellerId);

  return {
    description: t('description'),
    // Reached from a shared trip, not from a search engine (PRD 8.3).
    robots: { follow: false, index: false },
    title: profile ? (profile.traveller.name ?? t('anonymousName')) : t('notFoundTitle'),
  };
}

/**
 * A traveller's public view (PRD 8.3), open to anyone, signed in or not.
 *
 * Outside the proxy's guarded prefixes for the same reason `/shared` is: under
 * `/profile` a visitor would be sent to sign in before the page ran.
 */
export default async function TravellerPage({ params }: TravellerPageProps) {
  const [{ travellerId }, locale, userId] = await Promise.all([
    params,
    getLocale(),
    getAuthUserId(),
  ]);
  const profile = await fetchPublicTravellerProfile(travellerId);

  // Unknown and malformed ids alike, so the page is no more of a tell than the API.
  if (!profile) notFound();

  return (
    <PublicTravellerProfile
      isOwner={userId === profile.traveller.id}
      isSignedIn={userId !== null}
      locale={locale}
      profile={profile}
    />
  );
}
