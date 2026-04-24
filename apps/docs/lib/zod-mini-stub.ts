/**
 * zod/mini stub.
 *
 * `@scalar/agent-chat@0.10.x` (transitive of `@scalar/api-reference-react`)
 * imports `zod/mini`, which only exists in zod v4. Our workspace pins
 * `zod: ^3.25.76` via root `overrides` because most of our code (validators,
 * forms, env) targets the v3 API.
 *
 * The chat code path inside Scalar's API reference is never wired up in
 * our docs site — we render the OpenAPI spec only. The bundler still has
 * to resolve every transitive import, so this file exists purely to
 * satisfy module resolution. Anything that actually calls into it would
 * crash at runtime, which is fine because nothing does.
 */

const stub: Record<string, unknown> = new Proxy(
  {},
  {
    get() {
      return stub;
    },
  }
);

export const z = stub;
export default stub;
