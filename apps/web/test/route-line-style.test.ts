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

describe('route emphasis', () => {
  for (const mode of ['drive', 'walk', 'transit'] as const) {
    it(`keeps ${mode} patterns and emphasizes without erasing other legs`, () => {
      const normal = routeLineStyle(mode);
      const selected = routeLineStyle(mode, 'selected');
      const muted = routeLineStyle(mode, 'muted');
      const outline = routeLineStyle(mode, 'selected', true);
      expect(selected.strokeWeight).toBeGreaterThan(normal.strokeWeight);
      expect(outline.strokeWeight).toBeGreaterThan(selected.strokeWeight);
      if (mode === 'drive') {
        expect(muted.strokeOpacity).toBeGreaterThan(0);
        expect(muted.strokeOpacity).toBeLessThan(selected.strokeOpacity);
      } else {
        expect(selected.strokeOpacity).toBe(0);
        expect(outline.icons?.[0]?.repeat).toBe(selected.icons?.[0]?.repeat);
        expect(outline.icons?.[0]?.icon.path).toBe(normal.icons?.[0]?.icon.path);
        const opacity = (style: typeof normal) =>
          style.icons?.[0]?.icon.fillOpacity ?? style.icons?.[0]?.icon.strokeOpacity ?? 0;
        expect(opacity(muted)).toBeGreaterThan(0);
        expect(opacity(muted)).toBeLessThan(opacity(selected));
      }
    });
  }
});
