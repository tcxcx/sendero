import { searchFlightsTool } from './search-flights';
import { bookFlightTool } from './book-flight';
import { searchHotelsTool } from './search-hotels';
import { checkTreasuryTool } from './check-treasury';
import { gatewayBalanceTool } from './gateway-balance';
import { gatewayTransferTool } from './gateway-transfer';
import { swapTokensTool } from './swap-tokens';
import { sendTokensTool } from './send-tokens';
import { bridgeToArcTool } from './bridge-to-arc';
import { swapAndBridgeTool } from './swap-and-bridge';
import { settleSplitTool } from './settle-split';
import { checkPolicyTool } from './check-policy';
import { quoteFxTool } from './quote-fx';
import { rateAgentTool } from './rate-agent';
import {
  commitBookingTool,
  guestClaimLinkTool,
  logAgentActionTool,
  prefundTripTool,
  reserveBookingTool,
} from './guest-escrow';
import { confirmDuffelTool } from './confirm-duffel';
import { settleBookingTool } from './settle-booking';
import { cancelBookingTool } from './cancel-booking';
import { faucetDripTool } from './faucet';
import { recommendRestaurantsTool } from './recommend-restaurants';
import type { ToolDef } from './types';

export type { ToolDef, ToolContext, JsonSchemaObject } from './types';

// Re-export individual tool defs so API routes + workflow steps can
// import a single tool without walking the full registry.
export {
  commitBookingTool,
  guestClaimLinkTool,
  logAgentActionTool,
  prefundTripTool,
  reserveBookingTool,
} from './guest-escrow';
export { confirmDuffelTool } from './confirm-duffel';
export { settleBookingTool } from './settle-booking';
export { cancelBookingTool } from './cancel-booking';
export {
  faucetDripTool,
  requestFaucetDrip,
  type FaucetChain,
  type FaucetToken,
  type FaucetDripArgs,
  type FaucetDripResult,
} from './faucet';
export {
  recommendRestaurantsTool,
  recommendRestaurants,
  type RecommendRestaurantsInput,
  type RecommendRestaurantsResult,
  type RestaurantPlace,
  type RestaurantAddressComponent,
} from './recommend-restaurants';

/**
 * Ordered canonical list of every tool Sendero ships. Register here
 * once; both the AI SDK chat route and the MCP server derive their
 * catalogs from this array. Avoids tool drift.
 */
export const toolList: ToolDef[] = [
  searchFlightsTool,
  bookFlightTool,
  searchHotelsTool,
  checkTreasuryTool,
  gatewayBalanceTool,
  gatewayTransferTool,
  swapTokensTool,
  sendTokensTool,
  bridgeToArcTool,
  swapAndBridgeTool,
  settleSplitTool,
  checkPolicyTool,
  quoteFxTool,
  rateAgentTool,
  // Guest escrow — prefund-then-share (Peanut-style)
  prefundTripTool,
  guestClaimLinkTool,
  reserveBookingTool,
  commitBookingTool,
  confirmDuffelTool,
  settleBookingTool,
  cancelBookingTool,
  logAgentActionTool,
  // Concierge / in-trip companion
  recommendRestaurantsTool,
  // Ops helpers
  faucetDripTool,
];

/** Keyed registry for O(1) lookup by name. */
export const tools: Record<string, ToolDef> = Object.fromEntries(toolList.map(t => [t.name, t]));
