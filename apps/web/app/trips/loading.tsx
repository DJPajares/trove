// The route boundary must read the same client cache as the page. A fixed
// skeleton hides an already-loaded library on every dynamic route return.
// TripsManager reserves skeletons for the first read without cached data.
export { default } from './page';
