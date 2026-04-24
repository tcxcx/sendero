/**
 * Scope-filter the tool registry before handing it to the agent.
 *
 * The LLM never sees tools the caller isn't authorized for.  Removing
 * a tool from the registry is stronger than rejecting it at call
 * time — an LLM that can't see a method can't be tricked into calling
 * it via prompt injection.
 *
 * '*' in the granted scopes skips filtering entirely.  Sandbox +
 * service-account (AGENT_DISPATCH_SECRET) paths grant '*' implicitly.
 */

import { hasScope, type KeyScope, toolToScope } from '@sendero/auth/dispatch-auth';
import type { ToolDef } from '@sendero/tools';

export function filterToolsByScopes(
  tools: readonly ToolDef[],
  scopes: readonly KeyScope[]
): ToolDef[] {
  if (scopes.includes('*')) return [...tools];
  return tools.filter(t => hasScope(scopes, toolToScope(t.name)));
}
