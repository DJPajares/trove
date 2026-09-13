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
 * Deliberately modest: one fix, low accuracy. Trove asks where the traveller is
 * to place a marker, not to navigate for them, and a high-accuracy fix costs
 * battery on exactly the device least able to spare it.
 *
 * `maximumAge` is nought, though, so the one fix is a current one. Accepting a
 * minute-old position meant opening the map after walking a block put the
 * marker where the traveller had been, which is worse than no marker: it is
 * confidently wrong, and nothing on the screen says it is a minute stale. A
 * position read at low accuracy is usually answered from wifi rather than the
 * satellites, so asking for it afresh is cheap.
 */
const POSITION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 0,
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
/**
 * Remembers that the traveller has been asked, so a decline is never a nag.
 *
 * Per device rather than per account: the permission it tracks is the browser's,
 * and the browser is the thing that would show the prompt again.
 */
const ASKED_KEY = 'trove.location-asked';

function hasBeenAsked() {
  try {
    return window.localStorage.getItem(ASKED_KEY) === '1';
  } catch {
    // A browser that refuses storage is one that would be asked on every visit,
    // so it is treated as already asked rather than prompted forever.
    return true;
  }
}

function rememberAsked() {
  try {
    window.localStorage.setItem(ASKED_KEY, '1');
  } catch {
    // Nothing to do: the guard above already fails closed.
  }
}

export function useTravellerPosition({
  askOnce = false,
  enabled = true,
}: { askOnce?: boolean; enabled?: boolean } = {}) {
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
        // The one prompt Trove raises on its own, and only where a surface has
        // said it is worth raising. `prompt` means the traveller has neither
        // agreed nor refused; once asked, the answer stands either way and the
        // question is not put again.
        if (result.state === 'prompt' && askOnce && !hasBeenAsked()) {
          rememberAsked();
          read();
        }
      })
      .catch(() => {
        // A refused probe is not a refused permission; leave the tap available.
      });

    return () => {
      cancelled = true;
    };
  }, [askOnce, enabled, read]);

  return { position, request: read, status };
}
