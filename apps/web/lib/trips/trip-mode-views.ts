/**
 * The four views Trip Mode navigates between.
 *
 * A type of its own rather than one exported from a component, because the
 * route that validates a `[view]` segment is a server component and has no
 * business importing a client one to borrow a union from it.
 */
export type TripModeView = 'map' | 'now' | 'today' | 'trip';
