-- Flight legs are recorded so the itinerary can express a long-distance hop, but
-- they are never sent to the routing provider and are excluded from local travel
-- effort. Existing rows keep the 'drive' default.
ALTER TYPE "trove"."route_travel_mode" ADD VALUE 'flight';
