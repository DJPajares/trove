import { parseInstalledRelease } from './release';

/** The release this page was built from, inlined at build time. */
export const runningRelease = parseInstalledRelease(
  JSON.parse(process.env.NEXT_PUBLIC_TROVE_RELEASE ?? 'null'),
);
