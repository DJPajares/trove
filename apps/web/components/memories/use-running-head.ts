'use client';

import { type RefObject, useEffect, useState } from 'react';

/**
 * What the journal's header should say, the way a book's running head does:
 * nothing while the cover - which carries the title itself - is under it, then
 * the chapter being read.
 *
 * Two observers, both reading a thin line just beneath the header rather than
 * the scroll position, so nothing runs per frame: one notices the cover
 * passing under that line, the other which chapter currently spans it.
 */
/**
 * Where the header's lower edge sits once it is stuck - its sticky offset plus
 * its own height - rather than wherever it happens to be when this is read.
 */
function stuckHeadBottom(head: HTMLElement | null) {
  if (!head) return 0;
  const top = Number.parseFloat(window.getComputedStyle(head).top);
  return Math.round((Number.isFinite(top) ? top : 0) + head.offsetHeight);
}

export function useRunningHead({
  chapterSelector,
  coverRef,
  headRef,
  watchKey,
}: Readonly<{
  /**
   * The elements the running head follows. A match carrying
   * `data-journal-chapter` names its chapter; any other match - the contents,
   * say - hands the header back to the trip's own name.
   */
  chapterSelector: string;
  coverRef: RefObject<HTMLElement | null>;
  headRef: RefObject<HTMLElement | null>;
  /** Changes whenever the set of chapters on the page does, so they are observed afresh. */
  watchKey: string;
}>) {
  const [overCover, setOverCover] = useState(true);
  const [chapterId, setChapterId] = useState<string | null>(null);

  useEffect(() => {
    const cover = coverRef.current;
    if (!cover || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      ([entry]) => setOverCover(Boolean(entry?.isIntersecting)),
      { rootMargin: `-${stuckHeadBottom(headRef.current)}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(cover);
    return () => observer.disconnect();
  }, [coverRef, headRef, watchKey]);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const chapters = [...document.querySelectorAll<HTMLElement>(chapterSelector)];
    if (!chapters.length) {
      setChapterId(null);
      return;
    }

    const headBottom = stuckHeadBottom(headRef.current);
    const below = Math.max(0, window.innerHeight - headBottom - 2);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setChapterId(
            entry.target instanceof HTMLElement && 'journalChapter' in entry.target.dataset
              ? entry.target.id
              : null,
          );
        }
      },
      // A band two pixels tall, directly under the header.
      { rootMargin: `-${headBottom}px 0px -${below}px 0px`, threshold: 0 },
    );
    for (const chapter of chapters) observer.observe(chapter);
    return () => observer.disconnect();
  }, [chapterSelector, headRef, watchKey]);

  return { chapterId: overCover ? null : chapterId, overCover };
}
