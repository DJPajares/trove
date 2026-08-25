export type Appearance = 'dark' | 'light';
export type DateFormat = 'dmy' | 'mdy' | 'ymd';
export type DistanceUnit = 'km' | 'mi';
export type TemperatureUnit = 'celsius' | 'fahrenheit';
export type TimeFormat = '12h' | '24h';

export type ProfilePreferences = {
  appearance: Appearance;
  dateFormat: DateFormat;
  distanceUnit: DistanceUnit;
  temperatureUnit: TemperatureUnit;
  timeFormat: TimeFormat;
};

const metricRegions = new Set(['001', 'AU', 'CA', 'GB', 'IE', 'IN', 'NZ', 'SG', 'ZA']);

const dayMonthRegions = new Set(['AU', 'GB', 'IE', 'IN', 'NZ', 'SG', 'ZA']);
const yearMonthRegions = new Set(['CN', 'JP', 'KR', 'TW']);

function getLocaleRegion(locale: string) {
  try {
    return new Intl.Locale(locale).region ?? '001';
  } catch {
    return '001';
  }
}

export function getPreferenceDefaults(locale: string): ProfilePreferences {
  const region = getLocaleRegion(locale);
  const hourCycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions()
    .hourCycle;

  return {
    appearance: 'light',
    dateFormat: yearMonthRegions.has(region) ? 'ymd' : dayMonthRegions.has(region) ? 'dmy' : 'mdy',
    distanceUnit: metricRegions.has(region) ? 'km' : 'mi',
    temperatureUnit:
      region === 'US' || region === 'BS' || region === 'BZ' || region === 'KY'
        ? 'fahrenheit'
        : 'celsius',
    timeFormat: hourCycle === 'h11' || hourCycle === 'h12' ? '12h' : '24h',
  };
}

export function toggleAppearance(appearance: Appearance): Appearance {
  return appearance === 'dark' ? 'light' : 'dark';
}
