import { importLibrary, setOptions } from '@googlemaps/js-api-loader';

let configuredLanguage: string | null = null;

export function hasGoogleMapsConfiguration() {
  return Boolean(
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY && process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID,
  );
}

export function getGoogleMapsMapId() {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? null;
}

export async function loadGoogleMaps(language: string) {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const mapId = getGoogleMapsMapId();
  if (!key || !mapId) throw new Error('google_maps_configuration_missing');

  if (!configuredLanguage) {
    setOptions({
      authReferrerPolicy: 'origin',
      key,
      language,
      mapIds: [mapId],
      v: 'weekly',
    });
    configuredLanguage = language;
  } else if (configuredLanguage !== language) {
    throw new Error('google_maps_language_change_requires_reload');
  }

  const [maps, marker] = await Promise.all([importLibrary('maps'), importLibrary('marker')]);
  return { maps, marker };
}
