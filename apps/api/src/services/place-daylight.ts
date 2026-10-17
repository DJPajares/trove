import { timeZoneAtCoordinates } from './coordinate-time-zone.js';
import { formatInstantInTimeZone } from './itinerary-rules.js';
import { planningDateMinute, planningMinute } from './planning-clock.js';

/** NOAA solar approximation (https://gml.noaa.gov/grad/solcalc/solareqns.PDF).
 * Evaluated locally; polar day/night has no fabricated rise/set. */
export function daylightUtc(
  date: string,
  coordinates: { latitude: number; longitude: number },
): { sunrise: number; sunset: number } | null {
  const { latitude, longitude } = coordinates;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return null;
  const d = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return null;
  const day = 1 + (d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000;
  const daysInYear =
    (Date.UTC(d.getUTCFullYear() + 1, 0, 1) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000;
  const gamma = ((2 * Math.PI) / daysInYear) * (day - 1);
  const eq =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const dec =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const lat = (latitude * Math.PI) / 180;
  const cosine =
    Math.cos((90.833 * Math.PI) / 180) / (Math.cos(lat) * Math.cos(dec)) -
    Math.tan(lat) * Math.tan(dec);
  if (cosine < -1 || cosine > 1) return null;
  const ha = (Math.acos(cosine) * 180) / Math.PI;
  const noon = 720 - 4 * longitude - eq;
  return {
    sunrise: d.getTime() + (noon - 4 * ha) * 60000,
    sunset: d.getTime() + (noon + 4 * ha) * 60000,
  };
}
/** Location evidence only: express the sun's physical rise/set in that place's
 * own civil clock. No trip, item, home or device timezone enters this boundary;
 * planned times are never converted. The scheduling engine receives local hours.
 */
export function localDaylightWindow(
  date: string,
  coordinates: { latitude: number; longitude: number },
) {
  const light = daylightUtc(date, coordinates);
  if (!light) return null;
  const zone = timeZoneAtCoordinates(coordinates);
  if (!zone) return null;
  const minute = (instant: number) => {
    const local = formatInstantInTimeZone(new Date(instant), zone);
    return planningDateMinute(local.date, date, planningMinute(local.time));
  };
  return { startMinute: minute(light.sunrise), endMinute: minute(light.sunset) };
}
