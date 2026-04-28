/// <reference types="bun-types" />

// `tsconfig.json` extends the workspace root config which sets
// `moduleResolution: "bundler"` + `baseUrl` + `paths`. Under that mode,
// colon-prefixed module names like `bun:test` get treated as paths
// relative to baseUrl (tsc looks for `<baseUrl>/bun:test.ts`) instead
// of routing through the type-roots, so the @types/bun + bun-types
// chain never gets a chance to declare them.
//
// The triple-slash directive above forces tsc to load bun-types
// directly, which declares `bun:test` (and the other `bun:*` modules
// the CLI's tests use). One line, no tsconfig changes, no runtime
// impact.
