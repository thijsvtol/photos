/**
 * Minimal structured logger for the Cloudflare Worker.
 *
 * Cloudflare Workers Logs (see wrangler.toml's [observability.logs]) capture
 * whatever is written to the console — there's no built-in "minimum level"
 * setting to filter that at the platform level. To keep production logs at
 * WARN and above only (per-request noise like JWT parsing, user upserts, and
 * routine permission checks was previously logged on EVERY request via
 * console.log), this module gates `debug`/`info` behind an opt-in
 * `LOG_LEVEL=debug` env var (useful for local dev troubleshooting) while
 * `warn`/`error` always pass straight through to the real console methods so
 * they're never accidentally silenced.
 *
 * Usage: `const log = createLogger(c.env); log.warn('message', details);`
 * A route/module that doesn't have `env` handy (rare) can use the shared
 * `logger` export, which always behaves as if LOG_LEVEL were unset (i.e.
 * production-safe: debug/info suppressed, warn/error emitted).
 */

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

interface LogLevelEnv {
  LOG_LEVEL?: string;
}

function isDebugEnabled(env?: LogLevelEnv): boolean {
  return (env?.LOG_LEVEL || '').toLowerCase() === 'debug';
}

function makeLogger(env?: LogLevelEnv): Logger {
  const debugEnabled = isDebugEnabled(env);
  return {
    debug(...args: unknown[]) {
      if (debugEnabled) console.log(...args);
    },
    info(...args: unknown[]) {
      if (debugEnabled) console.log(...args);
    },
    // warn/error are never suppressed — these are exactly the ">= WARN"
    // level logs that should always reach Cloudflare's log stream.
    warn(...args: unknown[]) {
      console.warn(...args);
    },
    error(...args: unknown[]) {
      console.error(...args);
    },
  };
}

/** Build a logger scoped to a specific request's env (respects LOG_LEVEL). */
export function createLogger(env?: LogLevelEnv): Logger {
  return makeLogger(env);
}

/** Default production-safe logger (debug/info suppressed) for modules
 *  without easy access to the request env. */
export const logger: Logger = makeLogger();
