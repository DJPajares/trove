import {
  BedDouble,
  Compass,
  Landmark,
  MapPinned,
  ShoppingBag,
  TramFront,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';

import type { TrovePlaceCategory } from '@/lib/place-categories';

type PlaceCategoryFallback = {
  Icon: LucideIcon;
  gradientClassName: string;
};

/**
 * What Trove shows when there is no photograph.
 *
 * A hotel, a museum and a restaurant sharing one gradient made every unphotographed
 * card look like the same missing thing. Each category gets its own icon and its
 * own tint instead, so the placeholder still says something true about the place.
 *
 * The tints are theme tokens rather than literal colours because the same pair of
 * variables has to darken in dark mode; writing the stops inline is how the
 * previous gradient came to invert. Every class string is complete rather than
 * composed, because Tailwind only sees class names it can read in the source.
 */
const PLACE_CATEGORY_FALLBACKS: Record<TrovePlaceCategory, PlaceCategoryFallback> = {
  destination: {
    Icon: MapPinned,
    gradientClassName:
      'bg-[linear-gradient(145deg,var(--media-fallback-destination-from),var(--media-fallback-destination-to))]',
  },
  food_and_drink: {
    Icon: UtensilsCrossed,
    gradientClassName:
      'bg-[linear-gradient(145deg,var(--media-fallback-food-and-drink-from),var(--media-fallback-food-and-drink-to))]',
  },
  other: {
    Icon: Compass,
    gradientClassName:
      'bg-[linear-gradient(145deg,var(--media-fallback-other-from),var(--media-fallback-other-to))]',
  },
  shopping: {
    Icon: ShoppingBag,
    gradientClassName:
      'bg-[linear-gradient(145deg,var(--media-fallback-shopping-from),var(--media-fallback-shopping-to))]',
  },
  stay: {
    Icon: BedDouble,
    gradientClassName:
      'bg-[linear-gradient(145deg,var(--media-fallback-stay-from),var(--media-fallback-stay-to))]',
  },
  things_to_do: {
    Icon: Landmark,
    gradientClassName:
      'bg-[linear-gradient(145deg,var(--media-fallback-things-to-do-from),var(--media-fallback-things-to-do-to))]',
  },
  transport: {
    Icon: TramFront,
    gradientClassName:
      'bg-[linear-gradient(145deg,var(--media-fallback-transport-from),var(--media-fallback-transport-to))]',
  },
};

export function resolvePlaceCategoryFallback(category?: TrovePlaceCategory): PlaceCategoryFallback {
  return PLACE_CATEGORY_FALLBACKS[category ?? 'other'];
}
