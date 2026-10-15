/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Regenerates docs/ROUTES_AND_MODELS.json from the source tree:   npm run docs:routes
 * Pages come from app/**\/page.*, API routes from app/api/**\/route.ts (exported methods + the guard written in the file),
 * models from the Mongoose registry (collection, field names, index count).
 */
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import '../lib/models';
import { MODELS } from '../lib/models';

const root = process.cwd();
const walk = (dir: string, out: string[] = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const rel = (p: string) => path.relative(root, p).split(path.sep).join('/');
const urlOf = (file: string, base: string) => {
  const parts = rel(file).replace(/^app\//, '').split('/').slice(0, -1).filter((s) => !/^\(.*\)$/.test(s));
  return '/' + parts.join('/').replace(/\[([^\]]+)\]/g, ':$1') || '/';
};

const files = walk(path.join(root, 'app'));
const pages = files
  .filter((f) => /[\\/]page\.(tsx|js|jsx|ts)$/.test(f))
  .map((f) => ({ path: urlOf(f, 'app') || '/', file: rel(f), guard: f.includes(`${path.sep}login${path.sep}`) || f.includes('change-password') ? 'public / session-only' : 'proxy.ts cookie check + server session + client permission check' }))
  .sort((a, b) => a.path.localeCompare(b.path));

const apiRoutes = files
  .filter((f) => /[\\/]route\.ts$/.test(f))
  .map((f) => {
    const src = fs.readFileSync(f, 'utf8');
    const methods = [...src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
    const guards = [...src.matchAll(/(?:withAuth\(\s*([^,]+),\s*'(\w+)'|route\(\s*\{\s*auth:\s*'(\w+)')/g)].map((m) => (m[3] ? `auth:${m[3]}` : `${m[1].trim().startsWith("'") ? m[1].trim().slice(1, -1) : 'dynamic'}.${m[2]}`));
    return { path: urlOf(f, 'app/api'), file: rel(f), methods, guards: [...new Set(guards)] };
  })
  .sort((a, b) => a.path.localeCompare(b.path));

const models = Object.entries(MODELS).map(([resource, m]) => ({
  resource,
  model: m.modelName,
  collection: m.collection.name,
  fields: Object.keys(m.schema.paths).filter((k) => !['_id', 'createdAt', 'updatedAt'].includes(k)).length,
  indexes: m.schema.indexes().length + Object.values(m.schema.paths).filter((p: any) => p._index).length,
})).sort((a, b) => a.resource.localeCompare(b.resource));

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const out = {
  generatedFrom: 'scripts/gen-routes.ts (reads the source tree); regenerate with `npm run docs:routes`',
  generatedOn: new Date().toISOString().slice(0, 10),
  app: { name: pkg.name, next: pkg.dependencies.next, react: pkg.dependencies.react, mongoose: pkg.dependencies.mongoose, language: 'TypeScript (strict) with some remaining JavaScript screens' },
  summary: { pages: pages.length, apiRouteFiles: apiRoutes.length, models: models.length },
  pages,
  apiRoutes,
  models,
};
fs.writeFileSync('docs/ROUTES_AND_MODELS.json', JSON.stringify(out, null, 2) + '\n');
console.log(`pages ${pages.length}, api route files ${apiRoutes.length}, models ${models.length}`);
void mongoose;
