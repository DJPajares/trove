import { createSerwistRoute } from '@serwist/turbopack';

import { parseReleaseManifest } from '@/lib/updates/release';

const release = parseReleaseManifest(JSON.parse(process.env.TROVE_WEB_RELEASE ?? 'null'));
if (!release) throw new Error('Missing service worker release metadata');

export const { dynamic, dynamicParams, generateStaticParams, GET, revalidate } = createSerwistRoute(
  {
    additionalPrecacheEntries: [{ revision: release.buildId, url: '/~offline' }],
    esbuildOptions: { define: { __TROVE_RELEASE__: JSON.stringify(release) } },
    swSrc: 'app/sw.ts',
    useNativeEsbuild: true,
  },
);
