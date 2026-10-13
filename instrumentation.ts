// Runs once when the server starts: fail fast if the production environment is misconfigured (missing secrets etc.).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getEnv } = await import('./lib/env');
    getEnv();
  }
}
