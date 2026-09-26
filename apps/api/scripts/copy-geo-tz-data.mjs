import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const geoTzEntry = require.resolve('geo-tz');
const source = resolve(dirname(geoTzEntry), '..', 'data', 'timezones-1970.geojson.geo.dat');
const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destinationDirectory = resolve(apiRoot, 'dist/services/data');

await mkdir(destinationDirectory, { recursive: true });
await copyFile(source, resolve(destinationDirectory, 'timezones-1970.geojson.geo.dat'));
