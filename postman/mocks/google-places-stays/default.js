// Synthetic Google Places v1 Text Search responses for local stay verification.
// No live provider, API credentials, or booking/availability data are used.
const http = require('node:http');

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method !== 'POST' || req.url !== '/v1/places:searchText') {
        res.writeHead(501).end(JSON.stringify({ error: { status: 'UNIMPLEMENTED' } }));
        return;
      }
      const query = JSON.parse(body).textQuery;
      if (query.includes('Unavailable')) {
        res.writeHead(503).end(JSON.stringify({ error: { status: 'UNAVAILABLE' } }));
        return;
      }
      const names = ['Example Main Hotel', 'Example Temporary Hotel', 'Example Undated Hotel'];
      const name = names.find((entry) => query.includes(entry));
      if (!name) {
        res.end(JSON.stringify({ places: [] }));
        return;
      }
      res.end(
        JSON.stringify({
          places: [
            {
              id: `synthetic-${names.indexOf(name)}`,
              displayName: { text: name, languageCode: 'en' },
              formattedAddress: 'Example Street, Singapore',
              location: { latitude: 1.29 + names.indexOf(name) / 1000, longitude: 103.85 },
              types: ['hotel', 'lodging'],
              primaryType: 'hotel',
              addressComponents: [
                { longText: 'Singapore', shortText: 'Singapore', types: ['locality'] },
                { longText: 'Singapore', shortText: 'SG', types: ['country'] },
              ],
            },
          ],
        }),
      );
    });
  })
  .listen(process.env.PORT);
