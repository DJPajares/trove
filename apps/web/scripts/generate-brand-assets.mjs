import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import { brandLockup, brandMark, brandWordmark } from '../lib/brand/identity.ts';
import { themeColor } from '../lib/theme-color.ts';

const check = process.argv.includes('--check');
const webRoot = fileURLToPath(new URL('../', import.meta.url));
const css = await readFile(resolve(webRoot, 'app/globals.css'), 'utf8');

function brandColor(token, group = 'mark') {
  const name = `--brand-${group}-${token}`;
  const value = new RegExp(`${name}:\\s*(#[\\da-f]{6});`, 'i').exec(css)?.[1];
  if (!value) throw new Error(`Missing fixed ${name} colour`);
  return value;
}

// CSS owns the fixed brand palette, including exports that cannot read tokens.
const palette = {
  olive: brandColor('surface'),
  ivory: brandColor('ink'),
  terracotta: brandColor('accent'),
  terracottaOnOlive: brandColor('accent-on-surface'),
  walnut: brandColor('type'),
  tileSurface: brandColor('surface', 'tile'),
  tileInk: brandColor('ink', 'tile'),
  lightGround: themeColor.light,
  darkGround: themeColor.dark,
};

const { live } = brandMark;
const symbolViewBox = `${live.x} ${live.y} ${live.width} ${live.height}`;
const lockupViewBox = `0 0 ${brandLockup.width} ${brandLockup.height}`;

function indent(text, spaces) {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => `${pad}${line}`)
    .join('\n');
}

function svgDocument(body, width, height, viewBox) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}">\n${body}\n</svg>\n`;
}

function symbolParts({ bar, ribbon, small = false }) {
  const geometry = small ? brandMark.small : brandMark;
  return `<path d="${geometry.ribbon}" fill="${ribbon}" />\n<path d="${geometry.bar}" fill="${bar}" />`;
}

function symbolSvg(colors) {
  return svgDocument(
    indent(symbolParts(colors), 2),
    live.width * 2,
    live.height * 2,
    symbolViewBox,
  );
}

function wordmarkBody(ink) {
  const letters = brandWordmark.letters
    .map(({ path, x }) => `<path d="${path}" transform="translate(${x} 0)" />`)
    .join('\n');
  return `<g fill="${ink}">\n${indent(letters, 2)}\n</g>`;
}

function wordmarkSvg(ink) {
  return svgDocument(
    indent(wordmarkBody(ink), 2),
    brandWordmark.width * 2,
    brandWordmark.height * 2,
    brandWordmark.viewBox,
  );
}

function lockupBody({ bar, ribbon, word }) {
  const { symbol, wordmark } = brandLockup;
  return [
    `<g transform="translate(${symbol.x} ${symbol.y}) scale(${symbol.scale})">`,
    indent(symbolParts({ bar, ribbon }), 2),
    '</g>',
    `<g transform="translate(${wordmark.x} ${wordmark.y})">`,
    indent(wordmarkBody(word), 2),
    '</g>',
  ].join('\n');
}

function lockupSvg(colors) {
  return svgDocument(
    indent(lockupBody(colors), 2),
    brandLockup.width * 2,
    brandLockup.height * 2,
    lockupViewBox,
  );
}

/** Ivory on deep olive. Favicons take the small master. */
function iconSvg({ maskable = false, favicon = false } = {}) {
  const radius = maskable ? 0 : brandMark.tile.radius;
  const scale = maskable
    ? brandMark.maskableScale
    : favicon
      ? brandMark.faviconScale
      : brandMark.tile.scale;
  const parts = symbolParts({ bar: palette.tileInk, ribbon: palette.tileInk, small: favicon });
  const body = [
    `<rect width="64" height="64" rx="${radius}" fill="${palette.tileSurface}" />`,
    `<g transform="translate(32 ${32 + brandMark.tile.offsetY}) scale(${scale}) translate(-32 -32)">`,
    indent(parts, 2),
    '</g>',
  ].join('\n');
  const size = favicon ? 64 : 512;
  return svgDocument(indent(body, 2), size, size, brandMark.viewBox);
}

// Android reads only the alpha channel of a notification badge.
const badgeSvg = svgDocument(
  indent(
    [
      '<g transform="translate(32 32) scale(1.05) translate(-32 -32)">',
      indent(symbolParts({ bar: '#ffffff', ribbon: '#ffffff', small: true }), 2),
      '</g>',
    ].join('\n'),
    2,
  ),
  96,
  96,
  brandMark.viewBox,
);

// The share card carries no words beyond the wordmark, so it never needs translating.
function ogSvg() {
  const width = 1200;
  const height = 630;
  const scale = 640 / brandLockup.width;
  const x = (width - brandLockup.width * scale) / 2;
  const y = (height - brandLockup.height * scale) / 2;
  const body = [
    `<rect width="${width}" height="${height}" fill="${palette.olive}" />`,
    `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(4)})">`,
    indent(
      lockupBody({ bar: palette.ivory, ribbon: palette.terracottaOnOlive, word: palette.ivory }),
      2,
    ),
    '</g>',
  ].join('\n');
  return svgDocument(indent(body, 2), width, height, `0 0 ${width} ${height}`);
}

async function png(
  svg,
  width,
  height = width,
  { alpha = false, transparent = false, background = palette.olive } = {},
) {
  let image = sharp(Buffer.from(svg), { density: 144 }).resize(width, height);
  if (!transparent) image = image.flatten({ background });
  // Next's ICO decoder requires RGBA frames, even when every pixel is opaque.
  const encoded = alpha || transparent ? image.ensureAlpha() : image.removeAlpha();
  return encoded.png({ adaptiveFiltering: false, compressionLevel: 9, palette: false }).toBuffer();
}

// ICO can carry PNG frames directly; no second image-conversion library needed.
function ico(frames) {
  const directorySize = 6 + 16 * frames.length;
  const directory = Buffer.alloc(directorySize);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(frames.length, 4);
  let offset = directorySize;
  frames.forEach(({ size, bytes }, index) => {
    const entry = 6 + index * 16;
    directory[entry] = size;
    directory[entry + 1] = size;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(bytes.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += bytes.length;
  });
  return Buffer.concat([directory, ...frames.map(({ bytes }) => bytes)]);
}

const color = { bar: palette.olive, ribbon: palette.terracotta };
const colorInverse = { bar: palette.ivory, ribbon: palette.terracotta };
const mono = { bar: palette.olive, ribbon: palette.olive };
const monoInverse = { bar: palette.ivory, ribbon: palette.ivory };

const favicon = iconSvg({ favicon: true });
const launcher = iconSvg();
const maskable = iconSvg({ maskable: true });
const og = ogSvg();
const assets = new Map([
  ['app/icon.svg', Buffer.from(favicon)],
  ['public/brand/trove-icon.svg', Buffer.from(launcher)],
  ['public/brand/trove-icon-maskable.svg', Buffer.from(maskable)],
  ['public/brand/trove-mark.svg', Buffer.from(symbolSvg(color))],
  ['public/brand/trove-mark-inverse.svg', Buffer.from(symbolSvg(colorInverse))],
  ['public/brand/trove-mark-monochrome.svg', Buffer.from(symbolSvg(mono))],
  ['public/brand/trove-mark-monochrome-inverse.svg', Buffer.from(symbolSvg(monoInverse))],
  ['public/brand/trove-wordmark.svg', Buffer.from(wordmarkSvg(palette.walnut))],
  ['public/brand/trove-wordmark-inverse.svg', Buffer.from(wordmarkSvg(palette.ivory))],
  ['public/brand/trove-lockup.svg', Buffer.from(lockupSvg({ ...color, word: palette.walnut }))],
  [
    'public/brand/trove-lockup-inverse.svg',
    Buffer.from(lockupSvg({ ...colorInverse, word: palette.ivory })),
  ],
  [
    'public/brand/trove-lockup-monochrome.svg',
    Buffer.from(lockupSvg({ ...mono, word: palette.olive })),
  ],
  [
    'public/brand/trove-lockup-monochrome-inverse.svg',
    Buffer.from(lockupSvg({ ...monoInverse, word: palette.ivory })),
  ],
]);

for (const size of [180, 192, 512]) {
  assets.set(
    `public/icons/trove-${size}.png`,
    await png(launcher, size, size, { background: palette.tileSurface }),
  );
}
assets.set(
  'public/icons/trove-maskable-512.png',
  await png(maskable, 512, 512, { background: palette.tileSurface }),
);
assets.set('public/icons/trove-badge-96.png', await png(badgeSvg, 96, 96, { transparent: true }));
assets.set('public/brand/trove-og.png', await png(og, 1200, 630));
const frames = [];
for (const size of [16, 32, 48])
  frames.push({
    size,
    bytes: await png(favicon, size, size, { alpha: true, background: palette.tileSurface }),
  });
assets.set('app/favicon.ico', ico(frames));

const revisionHash = createHash('sha256');
for (const [path, bytes] of [...assets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  revisionHash.update(path).update('\0').update(bytes);
}
const revision = revisionHash.digest('hex').slice(0, 12);
assets.set(
  'lib/brand/revision.generated.ts',
  Buffer.from(
    `// Generated by scripts/generate-brand-assets.mjs; do not edit.\nexport const brandAssetRevision = '${revision}';\n`,
  ),
);

/** Embeds a generated SVG document at a position and size on the review sheet. */
function placed(source, x, y, width, height) {
  return `<g transform="translate(${x} ${y})">${source.replace(/width="[^"]+" height="[^"]+"/, `width="${width}" height="${height}"`)}</g>`;
}

const sans = 'font-family="ui-sans-serif, system-ui, sans-serif"';
const lockupRatio = brandLockup.height / brandLockup.width;
const symbolRatio = live.height / live.width;
const swatches = [
  ['Olive', palette.olive, '--brand-mark-surface'],
  ['Ivory', palette.ivory, '--brand-mark-ink'],
  ['Terracotta', palette.terracotta, '--brand-mark-accent'],
  ['Terracotta on olive', palette.terracottaOnOlive, '--brand-mark-accent-on-surface'],
  ['Walnut', palette.walnut, '--brand-mark-type'],
  ['Icon deep olive', palette.tileSurface, '--brand-tile-surface'],
  ['Icon ivory', palette.tileInk, '--brand-tile-ink'],
];

// A design review artifact, never an application route or PWA screen.
const reviewBody = [
  `<rect width="1200" height="1340" fill="${palette.lightGround}" />`,
  placed(lockupSvg({ ...color, word: palette.walnut }), 48, 40, 230, 230 * lockupRatio),
  `<g ${sans} fill="${palette.walnut}">`,
  '  <text x="48" y="122" font-size="22">Plan it. Live it. Remember it.</text>',
  '  <text x="1152" y="70" text-anchor="end" font-size="15">The Keepsake</text>',
  '</g>',
  `<rect x="48" y="156" width="540" height="250" rx="16" fill="${palette.ivory}" />`,
  placed(lockupSvg({ ...color, word: palette.walnut }), 128, 248, 380, 380 * lockupRatio),
  `<rect x="612" y="156" width="540" height="250" rx="16" fill="${palette.darkGround}" />`,
  placed(lockupSvg({ ...colorInverse, word: palette.ivory }), 692, 248, 380, 380 * lockupRatio),
  `<g ${sans} font-size="14">`,
  `  <text x="72" y="188" fill="${palette.olive}">Lockup on light</text>`,
  `  <text x="636" y="188" fill="${palette.ivory}">Lockup on dark</text>`,
  '</g>',
  placed(symbolSvg(color), 72, 452, 92, 92 * symbolRatio),
  placed(symbolSvg(mono), 232, 452, 92, 92 * symbolRatio),
  `<rect x="372" y="440" width="116" height="112" rx="12" fill="${palette.darkGround}" />`,
  placed(symbolSvg(colorInverse), 384, 452, 92, 92 * symbolRatio),
  `<rect x="512" y="440" width="116" height="112" rx="12" fill="${palette.darkGround}" />`,
  placed(symbolSvg(monoInverse), 524, 452, 92, 92 * symbolRatio),
  placed(launcher, 664, 440, 112, 112),
  placed(maskable, 812, 440, 112, 112),
  `<circle cx="868" cy="496" r="44.8" fill="none" stroke="${palette.ivory}" stroke-opacity="0.55" stroke-dasharray="3 4" />`,
  `<rect x="960" y="440" width="112" height="112" rx="12" fill="#5c5e57" />`,
  placed(badgeSvg, 980, 460, 72, 72),
  `<g ${sans} font-size="14" fill="${palette.walnut}">`,
  '  <text x="72" y="586">Symbol</text><text x="232" y="586">Monochrome</text>',
  '  <text x="372" y="586">On dark</text><text x="512" y="586">Mono on dark</text>',
  '  <text x="664" y="586">App icon</text><text x="812" y="586">Maskable, safe zone</text>',
  '  <text x="960" y="586">Notification badge</text>',
  '</g>',
  `<path d="M48 620H1152" stroke="${palette.walnut}" stroke-opacity="0.16" />`,
  `<g ${sans} font-size="14" fill="${palette.walnut}">`,
  '  <text x="48" y="664">Actual-size favicons (small master)</text>',
  '  <text x="560" y="664">Clear space: one ribbon width on every side</text>',
  '</g>',
  ...[16, 24, 32, 48].map((size, index) =>
    placed(favicon, 48 + index * 72, 704 - size / 2, size, size),
  ),
  `<g ${sans} font-size="13" fill="${palette.walnut}">`,
  ...[16, 24, 32, 48].map(
    (size, index) => `  <text x="${48 + index * 72}" y="760">${size}px</text>`,
  ),
  '</g>',
  placed(
    wordmarkSvg(palette.walnut),
    344,
    690,
    150,
    150 * (brandWordmark.height / brandWordmark.width),
  ),
  `<rect x="560" y="684" width="${48 * 3 + 14 * 3 * 2}" height="${46 * 3 + 14 * 3 * 2}" fill="none" stroke="${palette.olive}" stroke-opacity="0.5" stroke-dasharray="4 4" />`,
  placed(symbolSvg(color), 560 + 42, 684 + 42, 144, 144 * symbolRatio),
  `<g ${sans} font-size="13" fill="${palette.walnut}">`,
  '  <text x="820" y="720">Symbol: 16px minimum, small master below 24px</text>',
  '  <text x="820" y="746">App tile: 20px minimum</text>',
  '  <text x="820" y="772">Lockup: 72px wide minimum</text>',
  '  <text x="820" y="798">Never recolour, outline, rotate or separate the parts.</text>',
  '</g>',
  `<path d="M48 940H1152" stroke="${palette.walnut}" stroke-opacity="0.16" />`,
  ...swatches.flatMap(([name, value, token], index) => [
    `<rect x="${48 + (index % 4) * 276}" y="${972 + Math.floor(index / 4) * 148}" width="252" height="72" rx="12" fill="${value}" stroke="${palette.walnut}" stroke-opacity="0.12" />`,
    `<text ${sans} x="${48 + (index % 4) * 276}" y="${1068 + Math.floor(index / 4) * 148}" font-size="14" fill="${palette.walnut}">${name} ${value}</text>`,
    `<text ${sans} x="${48 + (index % 4) * 276}" y="${1090 + Math.floor(index / 4) * 148}" font-size="12" fill="${palette.walnut}" fill-opacity="0.7">${token}</text>`,
  ]),
  `<g ${sans} font-size="15" fill="${palette.walnut}">`,
  '  <text x="48" y="1298">A bar for the whole trip and a ribbon for what you keep: one T, read at any size, in one colour or two.</text>',
  '</g>',
].join('\n');
assets.set(
  '../../docs/brand/keepsake.svg',
  Buffer.from(svgDocument(indent(reviewBody, 2), 1200, 1340, '0 0 1200 1340')),
);

let stale = false;
for (const [relativePath, bytes] of assets) {
  const path = resolve(webRoot, relativePath);
  if (check) {
    const saved = await readFile(path).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!saved?.equals(bytes)) {
      console.error(`Stale brand asset: ${relativePath}`);
      stale = true;
    }
  } else {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
}
if (stale) {
  console.error('Run pnpm --filter @trove/web brand:generate and commit the regenerated assets.');
  process.exitCode = 1;
} else {
  console.log(`${check ? 'Verified' : 'Generated'} ${assets.size} brand assets (${revision}).`);
}
