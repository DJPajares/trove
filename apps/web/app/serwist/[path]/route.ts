import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { createSerwistRoute } from '@serwist/turbopack';

const revision =
  spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).stdout.trim() || randomUUID();

export const { dynamic, dynamicParams, generateStaticParams, GET, revalidate } = createSerwistRoute(
  {
    additionalPrecacheEntries: [{ revision, url: '/~offline' }],
    swSrc: 'app/sw.ts',
    useNativeEsbuild: true,
  },
);
