'use client';
// Small, dependency-free charts (plain SVG) for the home screens: lines, bars (single or stacked, with an optional second axis) and a donut.
// They replace recharts there: that library is ~370 KB of JavaScript and ~1 s of main-thread work on a phone to draw a handful of simple graphs.
// The container's width is read once by a ResizeObserver (no layout reads while rendering, so no forced reflow).
import { useEffect, useRef, useState } from 'react';

export const AXIS = '#CBD5E1', GRID = '#E2E8F0', MUTED = '#64748B';

function useWidth(fallback = 320) {
  const ref = useRef(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => { const next = Math.round(e.contentRect.width); if (next > 0) setW((cur) => (cur === next ? cur : next)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** A tidy axis for [lo, hi]: about `count` steps of 1, 2 or 5 x 10^n. */
function niceScale(lo, hi, count = 4, integer = false) {
  if (!(hi > lo)) { hi = lo + 1; }
  let step = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(step));
  const n = step / mag;
  step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  if (integer && step < 1) step = 1;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = min; v <= max + step / 1e6; v += step) ticks.push(+v.toFixed(10));
  return { min, max, ticks };
}

function Tip({ x, w, title, rows }) {
  if (!rows?.length) return null;
  const left = x > w / 2;
  return (
    <div className="pointer-events-none absolute top-1 z-10 border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900" style={{ [left ? 'right' : 'left']: left ? Math.max(0, w - x + 10) : x + 10 }}>
      {title && <div className="font-semibold mb-0.5">{title}</div>}
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-1.5 whitespace-nowrap">
          {r.color && <span className="inline-block w-2 h-2 shrink-0" style={{ background: r.color }} />}
          <span className="text-slate-600">{r.name}</span><b className="ml-auto pl-3">{r.value}</b>
        </div>
      ))}
    </div>
  );
}

function Legend({ items }) {
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-0.5 pt-2 text-[11px] text-slate-600">
      {items.map((i) => (
        <span key={i.name} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0 w-3.5 shrink-0" style={{ borderTop: `${i.bar ? 8 : 2}px ${i.dash ? 'dashed' : 'solid'} ${i.color}` }} />{i.name}
        </span>
      ))}
    </div>
  );
}

/**
 * Bars and / or lines over categories.
 *   bars:  [{ key, color, name, colors? }]   (stacked when `stacked`, else side by side; `colors` gives each bar its own colour)
 *   lines: [{ key, color, name, dash?, axis?: 'right' }]
 *   tip(row) -> [{ name, value, color }]; title(row) -> text; xLabel(row) -> axis label.
 */
export function XYChart({ data, bars = [], lines = [], stacked = false, height = 240, label, xLabel = (r) => r.day, title, tip, yFormat = (v) => v, y2Format = (v) => v, integer = false, legend = true, left = 44, right, xGap = 46 }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState(null);
  const rightLines = lines.filter((l) => l.axis === 'right');
  const leftLines = lines.filter((l) => l.axis !== 'right');
  const rightPad = right ?? (rightLines.length ? 34 : 10);
  const legendH = legend ? 24 : 0;
  const H = height - legendH;
  const top = 10, bottom = 22;
  const x0 = left, x1 = Math.max(x0 + 40, w - rightPad), y0 = top, y1 = H - bottom;
  const n = data.length || 1;
  const band = (x1 - x0) / n;
  const cx = (i) => x0 + band * (i + 0.5);

  // left axis spans the bars (stacked totals) and the left lines; the right axis only its own lines
  const stackTotal = (r) => bars.reduce((t, b) => t + (Number(r[b.key]) || 0), 0);
  const leftVals = [];
  for (const r of data) {
    if (bars.length) leftVals.push(stacked ? stackTotal(r) : Math.max(...bars.map((b) => Number(r[b.key]) || 0)));
    for (const l of leftLines) if (r[l.key] != null) leftVals.push(Number(r[l.key]) || 0);
  }
  const lo = bars.length ? 0 : Math.min(0, ...leftVals, 0);
  const sy = niceScale(lo, Math.max(0, ...leftVals), 4, integer);
  const yPos = (v) => y1 - ((v - sy.min) / (sy.max - sy.min || 1)) * (y1 - y0);
  const rightVals = data.flatMap((r) => rightLines.map((l) => Number(r[l.key]) || 0));
  const sy2 = rightLines.length ? niceScale(0, Math.max(0, ...rightVals), 4) : null;
  const yPos2 = (v) => y1 - ((v - sy2.min) / (sy2.max - sy2.min || 1)) * (y1 - y0);

  const every = Math.max(1, Math.ceil(xGap / (band || 1)));
  const path = (l) => {
    const pos = l.axis === 'right' ? yPos2 : yPos;
    let d = '', pen = false;
    data.forEach((r, i) => { if (r[l.key] == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${cx(i).toFixed(1)} ${pos(Number(r[l.key]) || 0).toFixed(1)}`; pen = true; });
    return d;
  };
  const move = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.min(n - 1, Math.max(0, Math.floor((e.clientX - box.left - x0) / band)));
    setHover(i);
  };
  const hov = hover != null ? data[hover] : null;
  const defaultTip = (r) => [...bars.map((b) => ({ name: b.name, value: String(r[b.key] ?? 0), color: b.color })), ...lines.map((l) => ({ name: l.name, value: String(r[l.key] ?? 0), color: l.color }))];
  const legendItems = [...bars.map((b) => ({ name: b.name, color: b.color, bar: true })), ...lines.map((l) => ({ name: l.name, color: l.color, dash: l.dash }))];
  const slot = stacked ? 1 : Math.max(1, bars.length);
  const bw = Math.max(2, Math.min(band * 0.7, 40) / slot);

  return (
    <div ref={ref} className="relative" style={{ height }} role="img" aria-label={label}>
      <svg width={w} height={H} className="block overflow-visible" onPointerMove={move} onPointerDown={move} onPointerLeave={() => setHover(null)}>
        {sy.ticks.map((t) => <g key={t}><line x1={x0} x2={x1} y1={yPos(t)} y2={yPos(t)} stroke={GRID} /><text x={x0 - 6} y={yPos(t) + 4} textAnchor="end" fontSize="11" fill={MUTED}>{yFormat(t)}</text></g>)}
        {sy2 && sy2.ticks.map((t) => <text key={'r' + t} x={x1 + 6} y={yPos2(t) + 4} fontSize="11" fill={MUTED}>{y2Format(t)}</text>)}
        <line x1={x0} x2={x0} y1={y0} y2={y1} stroke={AXIS} />
        <line x1={x0} x2={x1} y1={yPos(Math.max(0, sy.min))} y2={yPos(Math.max(0, sy.min))} stroke={AXIS} />
        {data.map((r, i) => (i % every === 0 ? <text key={'x' + i} x={cx(i)} y={H - 6} textAnchor="middle" fontSize="11" fill={MUTED}>{xLabel(r)}</text> : null))}
        {hover != null && <line x1={cx(hover)} x2={cx(hover)} y1={y0} y2={y1} stroke={AXIS} strokeDasharray="3 3" />}
        {data.map((r, i) => {
          let acc = 0;
          return bars.map((b, k) => {
            const v = Number(r[b.key]) || 0;
            if (v <= 0) return null;
            const base = stacked ? acc : 0;
            if (stacked) acc += v;
            const xx = stacked ? cx(i) - bw / 2 : cx(i) - (bw * slot) / 2 + k * bw;
            return <rect key={`${i}-${b.key}`} x={xx} width={bw} y={yPos(base + v)} height={Math.max(0, yPos(base) - yPos(base + v))} fill={b.colors?.[i % b.colors.length] ?? b.color} />;
          });
        })}
        {lines.map((l) => <path key={l.key} d={path(l)} fill="none" stroke={l.color} strokeWidth="2" strokeDasharray={l.dash} strokeLinejoin="round" />)}
        {hover != null && lines.map((l) => (data[hover][l.key] == null ? null : <circle key={'p' + l.key} cx={cx(hover)} cy={(l.axis === 'right' ? yPos2 : yPos)(Number(data[hover][l.key]) || 0)} r="3.5" fill="#fff" stroke={l.color} strokeWidth="2" />))}
      </svg>
      {hov && <Tip x={cx(hover)} w={w} title={title ? title(hov) : xLabel(hov)} rows={(tip || defaultTip)(hov)} />}
      {legend && legendItems.length > 1 && <Legend items={legendItems} />}
    </div>
  );
}

/** Slices of a total, as a ring; `center` is drawn in the middle. */
export function Donut({ data, valueKey = 'amount', nameKey = 'head', colors, size = 180, inner = 56, outer = 80, label, center, format = (v) => v }) {
  const [hover, setHover] = useState(null);
  const total = data.reduce((t, d) => t + (Number(d[valueKey]) || 0), 0) || 1;
  const c = size / 2;
  const pt = (r, a) => [c + r * Math.cos(a), c + r * Math.sin(a)];
  const fracs = data.map((d) => (Number(d[valueKey]) || 0) / total);
  const starts = fracs.map((_, i) => -Math.PI / 2 + fracs.slice(0, i).reduce((t, f) => t + f, 0) * Math.PI * 2); // where each slice begins
  const slices = data.map((d, i) => {
    const frac = fracs[i];
    const a0 = starts[i], a1 = a0 + frac * Math.PI * 2;
    const [ox0, oy0] = pt(outer, a0), [ox1, oy1] = pt(outer, a1), [ix1, iy1] = pt(inner, a1), [ix0, iy0] = pt(inner, a0);
    const big = frac > 0.5 ? 1 : 0;
    const full = frac >= 0.9999;
    const dPath = full ? null : `M${ox0} ${oy0}A${outer} ${outer} 0 ${big} 1 ${ox1} ${oy1}L${ix1} ${iy1}A${inner} ${inner} 0 ${big} 0 ${ix0} ${iy0}Z`;
    return { d, i, dPath, full, color: colors[i % colors.length] };
  });
  const h = hover != null ? data[hover] : null;
  return (
    <div className="relative" style={{ height: size }} role="img" aria-label={label}>
      <svg width="100%" height={size} viewBox={`0 0 ${size} ${size}`} className="block mx-auto" style={{ maxWidth: size }} onPointerLeave={() => setHover(null)}>
        {slices.map((s) => (s.full
          ? <circle key={s.i} cx={c} cy={c} r={(inner + outer) / 2} fill="none" stroke={s.color} strokeWidth={outer - inner} onPointerMove={() => setHover(s.i)} />
          : <path key={s.i} d={s.dPath} fill={s.color} stroke="#fff" strokeWidth="1" opacity={hover == null || hover === s.i ? 1 : 0.6} onPointerMove={() => setHover(s.i)} onPointerDown={() => setHover(s.i)} />))}
      </svg>
      <div className="absolute inset-0 grid place-items-center pointer-events-none text-center">{center}</div>
      {h && <Tip x={c} w={size} rows={[{ name: String(h[nameKey]), value: format(h[valueKey]), color: colors[hover % colors.length] }]} />}
    </div>
  );
}
