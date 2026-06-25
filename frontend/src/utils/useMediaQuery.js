import { useEffect, useState } from 'react';

/** Подписка на matchMedia; defaultMatches — SSR/первый кадр до эффекта. */
export function useMediaQuery(query, defaultMatches = false) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return defaultMatches;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export const MOBILE_MAX_WIDTH_QUERY = '(max-width: 768px)';
