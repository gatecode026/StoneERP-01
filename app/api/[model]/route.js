import { handler } from '@/lib/server';
import { listHandler, createHandler } from '@/lib/crud';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req, { params }) => listHandler(req, (await params).model));
export const POST = handler(async (req, { params }) => createHandler(req, (await params).model));
