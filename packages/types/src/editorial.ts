/** A small vocabulary for geographically grounded day-title photography. */
export const DAY_PHOTO_THEME_TERMS = {
  market: ['market', 'bazaar'],
  nightlife: ['night', 'nightlife', 'neon', 'illumination', 'lantern'],
  beach: ['beach', 'coast', 'seaside'],
  nature: ['nature', 'forest', 'mountain', 'hiking', 'park', 'garden'],
  museum: ['museum', 'gallery'],
  temple: ['temple', 'shrine'],
  food: ['food', 'cafe', 'restaurant', 'dining'],
  shopping: ['shopping', 'shop', 'mall'],
} as const;

export type DayPhotoTheme = keyof typeof DAY_PHOTO_THEME_TERMS;

export type EditorialImageContext = {
  area: string;
  countryCode?: string;
  theme?: DayPhotoTheme;
};

export function normalizeEditorialText(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** New day queries never invalidate or collide with existing Place/cover collections. */
export function contextualEditorialSubjectKey(name: string, context: EditorialImageContext) {
  return `day:v1:${JSON.stringify([
    normalizeEditorialText(name),
    normalizeEditorialText(context.area),
    context.countryCode?.toUpperCase() ?? '',
    context.theme ?? '',
  ])}`;
}
