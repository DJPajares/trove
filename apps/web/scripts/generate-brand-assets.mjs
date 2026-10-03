import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import { brandMark, brandWordmark } from '../lib/brand/identity.ts';

const check = process.argv.includes('--check');
const webRoot = fileURLToPath(new URL('../', import.meta.url));
const css = await readFile(resolve(webRoot, 'app/globals.css'), 'utf8');

function brandColor(token) {
  const value = new RegExp(`--brand-mark-${token}:\\s*(#[\\da-f]{6});`, 'i').exec(css)?.[1];
  if (!value) throw new Error(`Missing fixed --brand-mark-${token} colour`);
  return value;
}

// CSS owns the fixed brand palette, including exports that cannot read tokens.
const palette = {
  olive: brandColor('surface'),
  ivory: brandColor('ink'),
  terracotta: brandColor('accent'),
  walnut: '#33261f',
};

function svgDocument(body, width = 64, height = 64, viewBox = brandMark.viewBox) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}">\n${body}\n</svg>\n`;
}

function markBody(ink, accent = ink, scale = 1) {
  const { cx, cy, radius } = brandMark.terminal;
  return `  <g transform="translate(32 32) scale(${scale}) translate(-32 -32)">\n    <path d="${brandMark.path}" fill="none" stroke="${ink}" stroke-width="${brandMark.strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />\n    <circle cx="${cx}" cy="${cy}" r="${radius}" fill="${accent}" />\n  </g>`;
}

function wordmarkBody(ink) {
  return `  <g fill="${ink}" fill-rule="evenodd">\n${brandWordmark.letters.map(({ offset, path }) => `    <path d="${path}" transform="translate(${offset} 0)" />`).join('\n')}\n  </g>`;
}

function wordmarkSvg(ink) {
  return svgDocument(
    wordmarkBody(ink),
    brandWordmark.width,
    brandWordmark.height,
    brandWordmark.viewBox,
  );
}

function iconSvg({ maskable = false, favicon = false } = {}) {
  const radius = maskable ? 0 : brandMark.tileRadius;
  const scale = maskable ? brandMark.maskableScale : favicon ? brandMark.faviconScale : 1;
  const body = `  <rect width="64" height="64" rx="${radius}" fill="${palette.olive}" />\n${markBody(palette.ivory, favicon ? palette.ivory : palette.terracotta, scale)}`;
  return svgDocument(body, favicon ? 64 : 512, favicon ? 64 : 512);
}

function lockupSvg(inverse = false) {
  const ink = inverse ? palette.ivory : palette.olive;
  const word = inverse ? palette.ivory : palette.walnut;
  const body = `${markBody(ink, palette.terracotta)}\n  <svg x="72" y="13" width="120" height="34" viewBox="${brandWordmark.viewBox}">\n${wordmarkBody(word)}\n  </svg>`;
  return svgDocument(body, 204, 64, '0 0 204 64');
}

async function png(svg, size, alpha = false) {
  const image = sharp(Buffer.from(svg), { density: 144 })
    .resize(size, size)
    .flatten({ background: palette.olive });
  // Next's ICO decoder requires RGBA frames, even when every pixel is opaque.
  const opaqueImage = alpha ? image.ensureAlpha() : image.removeAlpha();
  return opaqueImage
    .png({ adaptiveFiltering: false, compressionLevel: 9, palette: false })
    .toBuffer();
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

const favicon = iconSvg({ favicon: true });
const launcher = iconSvg();
const maskable = iconSvg({ maskable: true });
const assets = new Map([
  ['app/icon.svg', Buffer.from(favicon)],
  ['public/brand/trove-icon.svg', Buffer.from(launcher)],
  ['public/brand/trove-icon-maskable.svg', Buffer.from(maskable)],
  [
    'public/brand/trove-mark.svg',
    Buffer.from(svgDocument(markBody(palette.olive, palette.terracotta))),
  ],
  ['public/brand/trove-mark-monochrome.svg', Buffer.from(svgDocument(markBody(palette.olive)))],
  ['public/brand/trove-mark-inverse.svg', Buffer.from(svgDocument(markBody(palette.ivory)))],
  ['public/brand/trove-wordmark.svg', Buffer.from(wordmarkSvg(palette.walnut))],
  ['public/brand/trove-wordmark-inverse.svg', Buffer.from(wordmarkSvg(palette.ivory))],
  ['public/brand/trove-lockup.svg', Buffer.from(lockupSvg())],
  ['public/brand/trove-lockup-inverse.svg', Buffer.from(lockupSvg(true))],
]);

for (const size of [180, 192, 512]) {
  assets.set(`public/icons/trove-${size}.png`, await png(launcher, size));
}
assets.set('public/icons/trove-maskable-512.png', await png(maskable, 512));
const frames = [];
for (const size of [16, 32, 48]) frames.push({ size, bytes: await png(favicon, size, true) });
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

function placedSvg(source, x, y, width, height) {
  return `<g transform="translate(${x} ${y})">${source.replace(/width="[^"]+" height="[^"]+"/, `width="${width}" height="${height}"`)}</g>`;
}

// This is a design review artifact, never an application route or PWA screen.
const reviewBody = [
  '  <rect width="1160" height="820" fill="#f8f1e7" />',
  placedSvg(wordmarkSvg(palette.walnut), 44, 36, 180, 51),
  '  <g font-family="ui-sans-serif, system-ui, sans-serif" fill="#33261f">',
  '    <text x="44" y="118" font-size="22">Plan it. Live it. Remember it.</text>',
  '    <text x="1116" y="70" text-anchor="end" font-size="15">The collected journey</text>',
  '  </g>',
  '  <rect x="44" y="152" width="520" height="246" rx="16" fill="#fcf7ee" />',
  placedSvg(lockupSvg(), 78, 231, 442, 139),
  '  <rect x="584" y="152" width="532" height="246" rx="16" fill="#12130d" />',
  placedSvg(lockupSvg(true), 624, 231, 442, 139),
  '  <g font-family="ui-sans-serif, system-ui, sans-serif" font-size="14">',
  '    <text x="70" y="185" fill="#515723">Primary lockup</text>',
  '    <text x="610" y="185" fill="#fcf7ee">Inverse lockup</text>',
  '  </g>',
  placedSvg(svgDocument(markBody(palette.olive, palette.terracotta)), 44, 445, 100, 100),
  placedSvg(svgDocument(markBody(palette.olive)), 208, 445, 100, 100),
  '  <rect x="372" y="445" width="100" height="100" rx="12" fill="#12130d" />',
  placedSvg(svgDocument(markBody(palette.ivory)), 372, 445, 100, 100),
  placedSvg(launcher, 536, 445, 100, 100),
  placedSvg(maskable, 700, 445, 100, 100),
  '  <g font-family="ui-sans-serif, system-ui, sans-serif" font-size="14" fill="#33261f">',
  '    <text x="44" y="578">Primary</text><text x="208" y="578">Monochrome</text>',
  '    <text x="372" y="578">Inverse</text><text x="536" y="578">App icon</text>',
  '    <text x="700" y="578">Maskable</text><text x="876" y="440">Actual-size favicons</text>',
  '  </g>',
  ...[16, 24, 32, 48].map((size, index) =>
    placedSvg(favicon, 876 + index * 60, 477 - size / 2, size, size),
  ),
  '  <g font-family="ui-sans-serif, system-ui, sans-serif" font-size="13" fill="#33261f">',
  ...[16, 24, 32, 48].map(
    (size, index) => `    <text x="${876 + index * 60}" y="526">${size}px</text>`,
  ),
  '  </g>',
  '  <path d="M44 620H1116" stroke="#d8cdbd" />',
  '  <g font-family="ui-sans-serif, system-ui, sans-serif" fill="#33261f">',
  '    <text x="44" y="667" font-size="19">One journey, gathered.</text>',
  '    <text x="44" y="703" font-size="16">A single ribbon turns through planning, travelling, and remembering.</text>',
  '    <text x="44" y="729" font-size="16">Its open pocket keeps a moment; the terracotta terminal gives it emphasis.</text>',
  '    <text x="44" y="755" font-size="16">The same silhouette holds in one colour, with no lettering or literal travel pictogram.</text>',
  '  </g>',
].join('\n');
assets.set(
  '../../docs/brand/collected-journey.svg',
  Buffer.from(svgDocument(reviewBody, 1160, 820, '0 0 1160 820')),
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
