import { brandAssetRevision } from './revision.generated';

/** A new URL lets browsers and installed PWAs recognize updated artwork. */
function assetUrl(path: string) {
  return `${path}?v=${brandAssetRevision}`;
}

export const brandAssets = {
  apple: assetUrl('/icons/trove-180.png'),
  favicon: assetUrl('/icon.svg'),
  faviconFallback: assetUrl('/favicon.ico'),
  launcher192: assetUrl('/icons/trove-192.png'),
  launcher512: assetUrl('/icons/trove-512.png'),
  maskable512: assetUrl('/icons/trove-maskable-512.png'),
} as const;
