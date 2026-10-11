// The shared trip layout already owns the trip and Overview query cache.
// Render from those reads while the route loads, reserving the skeleton for
// a first visit without a loaded trip instead of hiding it on every return.
export { default } from './page';
