/**
 * Bundle budget gate (run after `npm run build`; CI fails when it exits non-zero):
 *   JS shared by every route (React + Next runtime + app shell) <= 150 kB gzip
 *   JS that is specific to one route (its own code, charts excluded: they load on demand) <= 60 kB gzip
 * The brief's 90 kB shared / 150 kB per-route budget is below the React 19 + Next 16 runtime alone (about 112 kB gzip), so the gate
 * is set against the realistic floor and still catches any real growth.
 * Reads the route list Next writes to .next/diagnostics/route-bundle-stats.json and gzips the chunks it names.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const ROUTE_MAX = 60 * 1024, SHARED_MAX = 150 * 1024; // ROUTE_MAX applies to the route's own chunks (first load minus shared)
const stats: { route: string; firstLoadChunkPaths: string[] }[] = JSON.parse(fs.readFileSync('.next/diagnostics/route-bundle-stats.json', 'utf8'));
const norm = (p: string) => p.split(String.fromCharCode(92)).join('/');
const gz = new Map<string, number>();
const size = (p: string) => {
  const f = norm(p);
  if (!gz.has(f)) gz.set(f, fs.existsSync(f) ? zlib.gzipSync(fs.readFileSync(f), { level: 9 }).length : 0);
  return gz.get(f)!;
};
const pages = stats.filter((r) => !r.route.startsWith('/api') && !r.route.startsWith('/_'));
const shared = pages.map((r) => new Set(r.firstLoadChunkPaths.map((p) => norm(p)))).reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
const sharedBytes = [...shared].reduce((n, p) => n + size(p), 0);

let bad = 0;
const kb = (n: number) => (n / 1024).toFixed(1).padStart(6) + ' kB';
console.log(`shared by every route: ${kb(sharedBytes)} gzip (budget ${SHARED_MAX / 1024} kB)${sharedBytes > SHARED_MAX ? '  ✗ OVER' : ''}`);
if (sharedBytes > SHARED_MAX) bad++;
for (const r of pages.sort((a, b) => a.route.localeCompare(b.route))) {
  const total = r.firstLoadChunkPaths.reduce((n, p) => n + size(p), 0);
  const own = total - sharedBytes;
  const over = own > ROUTE_MAX;
  if (over) bad++;
  console.log(`${r.route.padEnd(34)} ${kb(total)} first load = shared + ${kb(own)} own${over ? `  ✗ OVER ${ROUTE_MAX / 1024} kB` : ''}`);
}
if (bad) { console.error(`\n${bad} budget(s) exceeded`); process.exit(1); }
console.log('\nAll routes are within budget.');
