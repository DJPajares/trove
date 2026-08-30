export type PublicItineraryItem = {
  /** Free text the traveller wrote in place of a Place, if any. */
  address: string | null;
  dayPart: 'afternoon' | 'anytime' | 'evening' | 'morning' | null;
  durationMinutes: number | null;
  id: string;
  localEndTime: string | null;
  localStartTime: string | null;
  /** Null where nothing has named this stop. The page supplies its own copy. */
  name: string | null;
  notes: string | null;
};

export type PublicItineraryDay = {
  date: string;
  id: string;
  items: PublicItineraryItem[];
  name: string | null;
  notes: string | null;
};

export type PublicItinerary = {
  days: PublicItineraryDay[];
  trip: { endDate: string; id: string; name: string; startDate: string };
};

const apiUrl = process.env.NEXT_PUBLIC_TROVE_API_URL ?? 'http://localhost:3001';

/**
 * The shared plan, read on the server with no credentials of any kind.
 *
 * Deliberately not `lib/itinerary/api.ts`. Every request there goes through
 * `itineraryRequest`, which demands a Supabase session and throws without one -
 * correct for a traveller's own trip and impossible for a visitor who has only
 * been handed a link. Going through the ordinary client would also mean the
 * offline store, the mutation queue and the query cache, none of which a page
 * with nothing to change has any use for.
 *
 * Returns null for anything the API declines to show, which is a trip that is
 * private, a trip that never existed, and a malformed id alike - the API answers
 * all three identically and so does this.
 */
export async function fetchPublicItinerary(tripId: string): Promise<PublicItinerary | null> {
  const response = await fetch(`${apiUrl}/public/trips/${encodeURIComponent(tripId)}/itinerary`, {
    // Matches the API's own max-age, so a link making the rounds in a group chat
    // is not one database read per tap, while turning sharing off still takes
    // effect while the owner is watching.
    next: { revalidate: 60 },
  });

  if (!response.ok) return null;
  return (await response.json()) as PublicItinerary;
}
