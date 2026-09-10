import {
  CloudDrizzle,
  CloudFog,
  CloudRain,
  CloudSun,
  Cloudy,
  Snowflake,
  Sun,
  Zap,
} from 'lucide-react';

import type { LucideIcon } from 'lucide-react';

/**
 * Below this a probability is not a forecast, it is a rounding error.
 *
 * The provider answers every day and every hour with a number, and drawing
 * "10%" down forty rows teaches the eye to skip the column that exists to make
 * it stop. A traveller changes plans somewhere around a third, so that is where
 * the droplet appears.
 */
export const NOTABLE_PRECIPITATION = 30;

/**
 * A WMO code narrowed to the handful of conditions worth naming.
 *
 * The provider distinguishes light from moderate freezing drizzle. A traveller
 * deciding whether to pack a coat does not, so the ninety-nine codes collapse to
 * the nine a sentence would actually use.
 */
export function weatherConditionKey(code: number) {
  if (code === 0) return 'clear';
  if ([1, 2, 3].includes(code)) return 'cloudy';
  if ([45, 48].includes(code)) return 'fog';
  if ([51, 53, 55, 56, 57].includes(code)) return 'drizzle';
  if ([61, 63, 65, 66, 67].includes(code)) return 'rain';
  if ([71, 73, 75, 77].includes(code)) return 'snow';
  if ([80, 81, 82].includes(code)) return 'showers';
  if ([85, 86].includes(code)) return 'snowShowers';
  if ([95, 96, 99].includes(code)) return 'thunderstorm';
  return 'unknown';
}

export type WeatherConditionKey = ReturnType<typeof weatherConditionKey>;

const icons: Record<WeatherConditionKey, LucideIcon> = {
  clear: Sun,
  cloudy: Cloudy,
  drizzle: CloudDrizzle,
  fog: CloudFog,
  rain: CloudRain,
  showers: CloudRain,
  snow: Snowflake,
  snowShowers: Snowflake,
  thunderstorm: Zap,
  unknown: CloudSun,
};

/** The icon carries no meaning on its own; every use pairs it with the label. */
export function weatherConditionIcon(code: number) {
  return icons[weatherConditionKey(code)];
}
