import app from '../dist/server.js';

const ready = app.ready();

export default async function handler(request, response) {
  await ready;
  app.server.emit('request', request, response);
}
