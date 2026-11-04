'use client';
// Charts that use the charting library (recharts, ~370 KB) are fetched only when they are about to be seen, so a screen shows its numbers first
// and the library never loads for someone who does not scroll down to the graphs.
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

export function InView({ height = 240, margin = '300px', children }) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return undefined; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [seen, margin]);
  return <div ref={ref} style={seen ? undefined : { minHeight: height }}>{seen ? children : <div className="skeleton" style={{ height }} />}</div>;
}

/** `inViewChart(() => import('...'))` : a client-only chart component that is downloaded and drawn when it comes near the screen. */
export function inViewChart(loader, { height = 240 } = {}) {
  const Chart = dynamic(loader, { ssr: false, loading: () => <div className="skeleton" style={{ height }} /> });
  return function LazyChart(props) {
    return <InView height={height}><Chart {...props} /></InView>;
  };
}
