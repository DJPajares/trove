import { createRequire } from 'node:module';

/**
 * The deployed API's SemVer, from its package.json. Both `src/` and `dist/`
 * sit one level below the package, and vercel.json ships the file with the
 * function.
 */
export const API_VERSION: string = createRequire(import.meta.url)('../package.json').version;
