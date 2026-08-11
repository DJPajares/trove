'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { pageTransition } from '@/lib/motion';

export function PageTransition({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const shouldReduceMotion = useReducedMotion();

  const initial = shouldReduceMotion ? false : { opacity: 0, y: 6 };
  const exit = shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: -3 };

  return (
    <AnimatePresence initial={false} mode="popLayout">
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        exit={exit}
        initial={initial}
        key={pathname}
        transition={shouldReduceMotion ? { duration: 0 } : pageTransition}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
