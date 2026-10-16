import type { RouteTravelMode } from '@/lib/itinerary/api';

/** A single repeated symbol along the line, in `google.maps.IconSequence` shape. */
type RouteLineIcon = {
  icon: {
    fillColor?: string;
    fillOpacity?: number;
    path: string;
    scale: number;
    strokeColor?: string;
    strokeOpacity: number;
    strokeWeight?: number;
  };
  repeat: string;
};

export type RouteLineStyle = {
  icons?: RouteLineIcon[];
  strokeOpacity: number;
  strokeWeight: number;
};

const LINE_OPACITY = 0.82;
const LINE_WEIGHT = 5;
/** A unit circle, so a dotted leg needs no `google.maps.SymbolPath` to be described. */
const DOT_PATH = 'M 0,0 m -1,0 a 1,1 0 1,0 2,0 a 1,1 0 1,0 -2,0';
const DASH_PATH = 'M 0,-1 0,1';

/**
 * How a travel leg is drawn for the mode the traveller chose. Google's `Polyline`
 * has no dash property — a broken line is a transparent stroke plus a repeated
 * symbol — so walking becomes dots, transit dashes, and driving stays the solid
 * line every leg used to be. `flight` legs are never routed, so they carry no
 * polyline to style and fall through to the default with everything else.
 *
 * Colours are left to the caller, which reads them from the theme at draw time.
 */
export function routeLineStyle(
  mode: RouteTravelMode,
  emphasis: 'normal' | 'selected' | 'muted' = 'normal',
  outline = false,
): RouteLineStyle {
  const opacity = emphasis === 'muted' ? 0.2 : emphasis === 'selected' ? 1 : LINE_OPACITY;
  const weight = (emphasis === 'selected' ? 7 : LINE_WEIGHT) + (outline ? 4 : 0);
  if (mode === 'walk') {
    return {
      icons: [
        {
          icon: {
            fillOpacity: opacity,
            path: DOT_PATH,
            scale: weight / 2,
            strokeOpacity: 0,
          },
          repeat: '12px',
        },
      ],
      strokeOpacity: 0,
      strokeWeight: weight,
    };
  }

  if (mode === 'transit') {
    return {
      icons: [
        {
          icon: {
            path: DASH_PATH,
            scale: emphasis === 'selected' ? 4 : 3,
            strokeOpacity: opacity,
            strokeWeight: weight,
          },
          repeat: '18px',
        },
      ],
      strokeOpacity: 0,
      strokeWeight: weight,
    };
  }

  return { strokeOpacity: opacity, strokeWeight: weight };
}
