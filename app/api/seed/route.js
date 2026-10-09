import { NextResponse } from 'next/server';
import { handler, getSession, HttpError } from '@/lib/server';
import { runSeed } from '@/lib/seed';
import { MODELS } from '@/lib/models';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/seed  -> seeds only when the database is empty (safe to open in a browser)
// GET /api/seed?force=1 or POST -> wipe and reload demo data (Owner only once logged in)
async function run(force) {
  const s = getSession();
  const empty = (await MODELS.employees.estimatedDocumentCount()) === 0;
  if (!empty && !force) return NextResponse.json({ ok: true, skipped: true, message: 'Database already has data. Use /api/seed?force=1 to reset.' });
  if (!empty && s && s.role !== 'owner') throw new HttpError(403, 'Only the Owner can reset demo data');
  const summary = await runSeed();
  return NextResponse.json({ ok: true, summary });
}

export const GET = handler(async (req) => run(new URL(req.url).searchParams.get('force') === '1'));
export const POST = handler(async () => run(true));
