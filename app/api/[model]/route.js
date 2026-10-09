import { handler } from '@/lib/server';
import { listHandler, createHandler } from '@/lib/crud';

export const dynamic = 'force-dynamic';

export const GET = handler((req, { params }) => listHandler(req, params.model));
export const POST = handler((req, { params }) => createHandler(req, params.model));
