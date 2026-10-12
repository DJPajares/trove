import { readFileSync } from 'node:fs';

import { withSerwist } from '@serwist/turbopack';
import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import createNextIntlPlugin from 'next-intl/plugin';

import { createReleaseManifest, parseReleaseManifest } from './lib/updates/release.ts';

const supabaseHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname;
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  devIndicators: false,
  images: {
    /**
     * The widest slot any image fills is the landing hero's `40vw`, and the
     * trip and story heroes cap at 1024px, so 2048 covers the largest of them
     * at 2x. The default list runs to 3840, which asked the provider for a
     * near-original of a decorative photograph.
     */
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048],
    /**
     * Supabase only, and deliberately not Pexels. `remotePatterns` gates
     * `/_next/image`, which editorial photography must never reach: it is
     * hotlinked by contract, so optimizing it would cache provider pixels
     * Trove is not entitled to keep and bill an optimization unit for
     * decoration. Leaving Pexels out keeps that a loud failure rather than a
     * silent cost if the frame ever loses its loader.
     */
    remotePatterns: supabaseHost
      ? [{ hostname: supabaseHost, pathname: '/storage/v1/object/**', protocol: 'https' }]
      : [],
  },
};
const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

export default function config(phase: string) {
  const release = parseReleaseManifest(JSON.parse(process.env.TROVE_WEB_RELEASE ?? 'null'));
  if (phase === PHASE_PRODUCTION_BUILD && !release) {
    throw new Error('Build through pnpm build so the app and worker share release metadata');
  }
  const manifest =
    release ??
    createReleaseManifest(
      [],
      'development',
      JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version,
    );
  const { entries: _entries, ...installed } = manifest;
  return withSerwist(
    withNextIntl({
      ...nextConfig,
      env: {
        TROVE_WEB_RELEASE: JSON.stringify(manifest),
        NEXT_PUBLIC_TROVE_RELEASE: JSON.stringify(installed),
      },
      generateBuildId: async () => manifest.buildId,
    }),
  );
}
