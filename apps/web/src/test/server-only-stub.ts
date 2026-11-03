// Vitest runs outside Next.js, where the `server-only` package throws on import. Tests that reach server modules (through a client component's
// imports) alias it to this empty module (vitest.config.ts). Next.js still uses the real package in builds.
export {};
