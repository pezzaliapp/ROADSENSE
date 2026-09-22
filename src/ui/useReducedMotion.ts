/**
 * ROAD SENSE - rispetto della preferenza "riduci movimento".
 *
 * Chi la imposta lo fa spesso per ragioni di salute, non di gusto: va
 * rispettata. In ROAD SENSE distingue cio' che e' DATO da cio' che e'
 * DECORAZIONE - la deriva di una cella resta, la sua pulsazione no.
 */

import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia(QUERY);
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return reduced;
}
