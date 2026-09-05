'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type TravellerPosition = {
  accuracyMeters: number | null;
  latitude: number;
  longitude: number;
};

export type TravellerPositionStatus =
  'denied' | 'idle' | 'loading' | 'ready' | 'unavailable' | 'unsupported';

/**
 * Deliberately modest: one fix, cached for a minute, low accuracy. Trove asks
 * where the traveller is to place a marker, not to navigate for them, and a
 * high-accuracy fix costs battery on exactly the device least able to spare it.
 */
const POSITION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 60_000,
  timeout: 10_000,
};

/**
 * The traveller's position, asked for rather than taken.
 *
 * Trove never prompts for location on its own. The one thing this does without
 * being told is *probe* an already-granted permission - reading a position the
 * traveller has previously agreed to share raises no prompt, so a surface that
 * wants to show a live marker can show one immediately on a return visit
 * instead of demanding another tap. Anything else waits for `request`.
 *
 * Pass `enabled: false` for Preview, where a real position would be answering a
 * question about a day the traveller is not living.
 */
export function useTravellerPosition({ enabled = true }: { enabled?: boolean } = {}) {
  const [position, setPosition] = useState<TravellerPosition | null>(null);
  const [status, setStatus] = useState<TravellerPositionStatus>('idle');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const read = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unsupported');
      return;
    }

    setStatus('loading');
    navigator.geolocation.getCurrentPosition(
      (result) => {
        if (!mounted.current) return;
        setPosition({
          accuracyMeters: Number.isFinite(result.coords.accuracy) ? result.coords.accuracy : null,
          latitude: result.coords.latitude,
          longitude: result.coords.longitude,
        });
        setStatus('ready');
      },
      (error) => {
        if (!mounted.current) return;
        setPosition(null);
        setStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable');
      },
      POSITION_OPTIONS,
    );
  }, []);

  useEffect(() => {
    if (!enabled) {
      setPosition(null);
      setStatus('idle');
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unsupported');
      return;
    }

    // Older Safari has no Permissions API, and some browsers refuse the
    // geolocation descriptor outright. Both are answered the same way: say
    // nothing, and wait to be asked.
    if (!navigator.permissions?.query) return;

    let cancelled = false;
    void navigator.permissions
      .query({ name: 'geolocation' })
      .then((result) => {
        if (cancelled || !mounted.current) return;
        if (result.state === 'granted') read();
        if (result.state === 'denied') setStatus('denied');
      })
      .catch(() => {
        // A refused probe is not a refused permission; leave the tap available.
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, read]);

  return { position, request: read, status };
}
