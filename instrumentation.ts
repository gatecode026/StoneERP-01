// Runs once when the server starts: check the environment (missing secrets etc.) and say so loudly in the logs.
// It does not throw: a thrown error turns every request (even the icon) into a bare "Internal Server Error" with nothing to read.
// Instead proxy.ts answers every page with a 503 that names the setting at fault (names only, never values).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getEnv } = await import('./lib/env');
    try { getEnv(); } catch (e) { console.error(`[startup] ${(e as Error).message}`); }
  }
}

// Next calls this for every error a page, route handler or server action did not handle itself
export async function onRequestError(err: unknown, request: { path: string; method: string }, context: { routeType?: string; routePath?: string }) {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { reportError } = await import('./lib/errorReport');
  await reportError(err, { path: request.path, method: request.method, routeType: context.routeType, routePath: context.routePath });
}
