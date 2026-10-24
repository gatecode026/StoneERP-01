import { withAuth } from '@/lib/api/withAuth';
import { jsonWithEtag } from '@/lib/api/http';
import { lookupKind, runLookup } from '@/lib/services/typeahead';

export const dynamic = 'force-dynamic';

/** Dropdown / typeahead source: /api/lookup/{employees|machines|items|customers|suppliers|vehicles|blocks|sales}?q=…  →  { data: [{ id, label, hint? }] }, max 20. */
export const GET = withAuth(
  (c) => lookupKind(c.params.kind).resource,
  'view',
  async (auth) => {
    const kind = lookupKind(auth.params.kind);
    const out = await runLookup(kind, auth.query, await auth.filter('view'));
    return jsonWithEtag(auth.req, out, { maxAge: 15 });
  }
);
