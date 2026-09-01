-- A trip's own framing of itself, rather than a planning scratchpad.
--
-- Renamed rather than dropped and re-added: what travellers already wrote in
-- trip notes reads as a description of the trip more than as anything else, so
-- the content survives as the thing it always was. Trove has five other notes
-- fields; this one was the odd one out.
ALTER TABLE "trove"."trips" RENAME COLUMN "notes" TO "description";
