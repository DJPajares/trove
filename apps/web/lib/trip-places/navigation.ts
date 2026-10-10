/** Only the drawer's query parameter changes; the underlying screen stays put. */
export function tripPlacesDrawerHref(href: string, open: boolean) {
  const url = new URL(href, 'https://trove.invalid');
  if (open) url.searchParams.set('places', '1');
  else url.searchParams.delete('places');
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Old bookmarks and search results enter the collection from the trip hub. */
export function tripPlacesHref(tripId: string) {
  return tripPlacesDrawerHref(`/trips/${tripId}`, true);
}

export function canReturnFromPlaces(state: unknown, currentHref: string) {
  if (!state || typeof state !== 'object' || !('trovePlacesReturnHref' in state)) return false;
  return state.trovePlacesReturnHref === tripPlacesDrawerHref(currentHref, false);
}
