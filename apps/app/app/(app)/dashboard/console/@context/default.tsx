/**
 * Next.js parallel-routes fallback.
 *
 * Required when a layout receives a named slot prop but the route
 * tree doesn't have a matching page for that slot at every URL.
 * For the console layout this file fires on hard-reloads of nested
 * routes that don't render the slot — keeps the layout's shape
 * stable instead of throwing.
 *
 * Mirrors the slot's loading state so the visual hierarchy stays
 * intact while the route resolves.
 */

import ContextLoading from './loading';

export default function ContextDefault() {
  return <ContextLoading />;
}
