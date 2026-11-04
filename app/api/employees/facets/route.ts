import type { NextRequest } from 'next/server';
import { GET as facets } from '../../[resource]/facets/route';

export const dynamic = 'force-dynamic';

/**
 * Counts and totals for the Employees list (see app/api/[resource]/facets). It needs its own file because /api/employees/[id] exists:
 * without this, "/api/employees/facets" was read as "the employee whose id is facets" and answered 404.
 */
export const GET = (req: NextRequest) => facets(req, { params: Promise.resolve({ resource: 'employees' }) });
