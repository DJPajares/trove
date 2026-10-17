import type { SketchPoint } from './route-sketch';

/**
 * Decodes a route's encoded polyline (Google's precision-5 format) into the
 * points it passes through. It reads geometry a route already carries - it
 * never asks for any - so a drawing can follow the road when the road is known.
 * A malformed string yields what decoded cleanly before it.
 */
export function decodePolyline(encoded: string): SketchPoint[] {
  const points: SketchPoint[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  function next(): number | null {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) return null;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  }

  while (index < encoded.length) {
    const deltaLatitude = next();
    const deltaLongitude = next();
    if (deltaLatitude === null || deltaLongitude === null) break;
    latitude += deltaLatitude;
    longitude += deltaLongitude;
    points.push({ latitude: latitude / 1e5, longitude: longitude / 1e5 });
  }

  return points;
}
