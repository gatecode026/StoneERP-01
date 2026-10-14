// Runs once when the server starts: fail fast if the production environment is misconfigured (missing secrets etc.).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getEnv } = await import('./lib/env');
    getEnv();
  }
}

// Next calls this for every error a page, route handler or server action did not handle itself
export async function onRequestError(err: unknown, request: { path: string; method: string }, context: { routeType?: string; routePath?: string }) {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { reportError } = await import('./lib/errorReport');
  await reportError(err, { path: request.path, method: request.method, routeType: context.routeType, routePath: context.routePath });
}
