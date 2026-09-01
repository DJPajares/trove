import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

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
    'public/brand/trove-lockup.svg',
    'public/brand/trove-mark.svg',
    'public/brand/trove-mark-monochrome.svg',
  ])('%s stays flat and vector-first', async (relativePath) => {
    const source = await readFile(assetPath(relativePath), 'utf8');

    expect(source).toContain('<svg');
    expect(source).not.toMatch(/<(?:filter|linearGradient|radialGradient)\b/);
  });
});
