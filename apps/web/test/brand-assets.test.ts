import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';
import sharp from 'sharp';

const webRoot = fileURLToPath(new URL('../', import.meta.url));

function assetPath(relativePath: string) {
  return `${webRoot}${relativePath}`;
}

function readPngHeader(bytes: Buffer) {
  expect(bytes.subarray(0, 8)).toStrictEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  expect(bytes.toString('ascii', 12, 16)).toBe('IHDR');

  return {
    colorType: bytes.readUInt8(25),
    height: bytes.readUInt32BE(20),
    width: bytes.readUInt32BE(16),
  };
}

describe('Trove brand assets', () => {
  test.each([
    ['public/icons/trove-180.png', 180],
    ['public/icons/trove-192.png', 192],
    ['public/icons/trove-512.png', 512],
    ['public/icons/trove-maskable-512.png', 512],
  ])('%s is an opaque square PNG at the declared size', async (relativePath, size) => {
    const header = readPngHeader(await readFile(assetPath(relativePath)));

    expect(header).toStrictEqual({ colorType: 2, height: size, width: size });
  });

  test.each([
    'app/icon.svg',
    'public/brand/trove-icon.svg',
    'public/brand/trove-icon-maskable.svg',
    'public/brand/trove-mark.svg',
    'public/brand/trove-mark-inverse.svg',
    'public/brand/trove-mark-monochrome.svg',
    'public/brand/trove-mark-monochrome-inverse.svg',
    'public/brand/trove-wordmark.svg',
    'public/brand/trove-wordmark-inverse.svg',
    'public/brand/trove-lockup.svg',
    'public/brand/trove-lockup-inverse.svg',
    'public/brand/trove-lockup-monochrome.svg',
    'public/brand/trove-lockup-monochrome-inverse.svg',
  ])('%s stays flat and vector-first', async (relativePath) => {
    const source = await readFile(assetPath(relativePath), 'utf8');

    expect(source).toContain('<svg');
    expect(source).not.toMatch(/<(?:filter|linearGradient|radialGradient)\b/);
  });

  test.each([
    'public/brand/trove-lockup.svg',
    'public/brand/trove-lockup-inverse.svg',
    'public/brand/trove-lockup-monochrome.svg',
    'public/brand/trove-lockup-monochrome-inverse.svg',
    'public/brand/trove-wordmark.svg',
    'public/brand/trove-wordmark-inverse.svg',
  ])('%s needs no installed font', async (relativePath) => {
    expect(await readFile(assetPath(relativePath), 'utf8')).not.toMatch(/<text\b|font-family/);
  });

  test('the share card is an opaque 1200x630 PNG', async () => {
    const header = readPngHeader(await readFile(assetPath('public/brand/trove-og.png')));

    expect(header).toStrictEqual({ colorType: 2, height: 630, width: 1200 });
  });

  // Android draws a notification badge from its alpha channel alone, so an
  // opaque square would show as a solid white block in the status bar.
  test('the notification badge is a white silhouette on transparency', async () => {
    const path = assetPath('public/icons/trove-badge-96.png');
    expect(readPngHeader(await readFile(path))).toStrictEqual({
      colorType: 6,
      height: 96,
      width: 96,
    });
    const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
    let inked = 0;
    for (let pixel = 0; pixel < data.length; pixel += info.channels) {
      const alpha = data[pixel + 3]!;
      if (alpha === 0) continue;
      inked += 1;
      if (alpha === 255)
        expect([data[pixel], data[pixel + 1], data[pixel + 2]]).toEqual([255, 255, 255]);
    }
    expect(data[3]).toBe(0);
    expect(inked).toBeGreaterThan(0);
  });

  test('the favicon fallback contains opaque 16, 32, and 48px PNG frames', async () => {
    const bytes = await readFile(assetPath('app/favicon.ico'));
    expect(bytes.readUInt16LE(0)).toBe(0);
    expect(bytes.readUInt16LE(2)).toBe(1);
    expect(bytes.readUInt16LE(4)).toBe(3);

    for (const [index, size] of [16, 32, 48].entries()) {
      const entry = 6 + index * 16;
      const length = bytes.readUInt32LE(entry + 8);
      const offset = bytes.readUInt32LE(entry + 12);
      expect(offset + length).toBeLessThanOrEqual(bytes.length);
      const frame = bytes.subarray(offset, offset + length);
      expect(readPngHeader(frame)).toStrictEqual({
        colorType: 6,
        height: size,
        width: size,
      });
      const alpha = await sharp(frame).extractChannel('alpha').raw().toBuffer();
      expect(alpha.every((opacity) => opacity === 255)).toBe(true);
    }
  });

  test('all visible maskable artwork fits inside the launcher safe zone', async () => {
    const { data, info } = await sharp(assetPath('public/icons/trove-maskable-512.png'))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const background = data.subarray(0, info.channels);
    const center = info.width / 2;
    let furthest = 0;

    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const pixel = (y * info.width + x) * info.channels;
        if (data.subarray(pixel, pixel + info.channels).equals(background)) continue;
        furthest = Math.max(furthest, Math.hypot(x + 0.5 - center, y + 0.5 - center));
      }
    }

    expect(furthest).toBeGreaterThan(0);
    expect(furthest).toBeLessThanOrEqual(info.width * 0.4);
  });
});
