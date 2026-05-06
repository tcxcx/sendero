/**
 * Internal shims — adapters that expose the tool's `.handler` as a
 * callable function, so multi-tool finder files don't have to also
 * export individual `run*` named handlers. Keeps the multi-tool files
 * compact while letting orchestrators call into them by intent.
 *
 * NOT a public API. Only used by HP1 orchestrators
 * (`city_hobby_pack_builder`, `hobby_map_layer_builder`).
 */

import type { ToolContext } from '../types';
import {
  artGalleryOpeningFinderTool,
  type CulturalCommerceFinderInput,
  type CulturalCommerceFinderResult,
} from './cultural-commerce-finders';
import {
  runningRouteFinderTool,
  type PhysicalActivityFinderInput,
  type PhysicalActivityFinderResult,
} from './physical-activity-finders';

export function runArtGalleryOpeningFinder(
  input: CulturalCommerceFinderInput,
  ctx?: ToolContext
): Promise<CulturalCommerceFinderResult> {
  return artGalleryOpeningFinderTool.handler(input, ctx);
}

export function runRunningRouteFinder(
  input: PhysicalActivityFinderInput,
  ctx?: ToolContext
): Promise<PhysicalActivityFinderResult> {
  return runningRouteFinderTool.handler(input, ctx);
}
