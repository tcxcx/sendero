/**
 * HP3 internal shims — see `_finder-shims.ts` for the same pattern.
 * Lets `date-closure.ts` call into HP1 finders by intent without each
 * finder file having to also export its run* handler.
 */

import type { ToolContext } from '../types';
import { wineBarFinderTool, type CulturalCommerceFinderInput, type CulturalCommerceFinderResult } from './cultural-commerce-finders';
import {
  type FoodieShortlistBuilderInput,
  type FoodieShortlistBuilderResult,
  runFoodieShortlistBuilder as _runFoodie,
} from './foodie-shortlist-builder';

export function runWineBarFinder(
  input: CulturalCommerceFinderInput,
  ctx?: ToolContext
): Promise<CulturalCommerceFinderResult> {
  return wineBarFinderTool.handler(input, ctx);
}

export function runFoodieShortlistBuilder(
  input: FoodieShortlistBuilderInput,
  ctx?: ToolContext
): Promise<FoodieShortlistBuilderResult> {
  return _runFoodie(input, ctx);
}
