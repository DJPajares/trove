import { describe, expect, it } from 'vitest';

import { routeLineStyle } from '@/lib/maps/route-line-style';

describe('routeLineStyle', () => {
  it('draws a driving leg as a solid line', () => {
    const style = routeLineStyle('drive');
    expect(style.strokeOpacity).toBeGreaterThan(0);
    expect(style.icons).toBeUndefined();
  });

  it('breaks a walking leg into repeated dots', () => {
    const style = routeLineStyle('walk');
    expect(style.strokeOpacity).toBe(0);
    expect(style.icons).toHaveLength(1);
    expect(style.icons?.[0]?.icon.fillOpacity).toBeGreaterThan(0);
  });

  it('breaks a transit leg into repeated dashes', () => {
    const style = routeLineStyle('transit');
    expect(style.strokeOpacity).toBe(0);
    expect(style.icons?.[0]?.icon.strokeOpacity).toBeGreaterThan(0);
  });

  it('leaves an unrouted flight leg on the solid default', () => {
    expect(routeLineStyle('flight')).toEqual(routeLineStyle('drive'));
  });
});
