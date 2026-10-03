import {
  BookMarked,
  CalendarDays,
  Compass,
  Info,
  ListChecks,
  MapPinned,
  StickyNote,
  Ticket,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';

import type { TripSection } from '@/lib/trips/navigation';

/**
 * Trove's icon vocabulary: one Lucide glyph per product concept.
 *
 * Import concept icons from here (`import * as Icons from '@/lib/icons'`, then
 * `<Icons.Trips />`) rather than from lucide-react, so a concept cannot drift to
 * a second glyph and a glyph cannot quietly take on a second meaning. Generic
 * controls (close, chevrons, edit, delete, overflow, search, copy, share, the
 * inline add) stay direct Lucide imports. The lint config bans the concept-only
 * glyphs outside this file. See docs/brand/README.md.
 */

// Global navigation
export {
  Backpack as Tools,
  Bookmark as Saved,
  House as Home,
  Luggage as Trips,
  Plus as Create,
} from 'lucide-react';

// The three experiences, and how they open
export {
  BookMarked as Memories,
  CalendarDays as Itinerary,
  Clock3 as Now,
  Compass as TripMode,
  Eye as Preview,
  Gem as Highlight,
} from 'lucide-react';

// Places and maps
export {
  BedDouble as DailyBase,
  Map as MapView,
  MapPin as Place,
  MapPinPen as CustomPlace,
  MapPinned as Places,
  Navigation as Directions,
} from 'lucide-react';

// Planning and trip tools
export {
  ClipboardList as TaskTemplates,
  Coins as Currency,
  Flag as MustGo,
  Gauge as PlanScore,
  Info as TripInfo,
  ListChecks as Tasks,
  Shapes as Other,
  Sparkles as Ai,
  StickyNote as Notes,
  Ticket as Reservations,
  WalletCards as Expenses,
} from 'lucide-react';

// Status
export {
  CircleAlert as Error,
  CircleCheck as Success,
  RefreshCw as Sync,
  TriangleAlert as Warning,
  WifiOff as Offline,
} from 'lucide-react';

/**
 * Every trip destination's glyph, shared by the overview, Trip Mode's tools and
 * the trip menu so the three can never disagree again.
 */
export const tripSectionIcons = {
  expenses: WalletCards,
  info: Info,
  itinerary: CalendarDays,
  memories: BookMarked,
  mode: Compass,
  notes: StickyNote,
  places: MapPinned,
  reservations: Ticket,
  tasks: ListChecks,
} as const satisfies Record<TripSection | 'notes', LucideIcon>;
