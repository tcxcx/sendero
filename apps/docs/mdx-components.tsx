import type { MDXComponents } from 'mdx/types';

import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';

/**
 * Sendero docs MDX component registry.
 *
 * Defaults from `fumadocs-ui/mdx` cover headings, prose, codeblocks,
 * callouts. We layer Fumadocs `Tabs` + `Tab` so every MDX page can
 * use `<Tabs items={[...]}>` without per-file imports — used by
 * `/docs/mcp-integration` to surface a per-client install panel
 * (Claude Desktop, Claude Code, Cursor, VS Code, Codex).
 */
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    Tabs,
    Tab,
    ...components,
  };
}
