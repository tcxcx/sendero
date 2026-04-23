import { airQualityBriefTool } from './air-quality-brief';
import { bookFlightTool } from './book-flight';
import { bridgeToArcTool } from './bridge-to-arc';
import { cancelBookingTool } from './cancel-booking';
import { checkPolicyTool } from './check-policy';
import { checkTreasuryTool } from './check-treasury';
import { confirmDuffelTool } from './confirm-duffel';
import { elevationRiskBriefTool } from './elevation-risk-brief';
import { exportRouteMapTool } from './export-route-map';
import { faucetDripTool } from './faucet';
import { gatewayBalanceTool } from './gateway-balance';
import { gatewayTransferTool } from './gateway-transfer';
import { generateBookingInvoiceTool } from './generate-booking-invoice';
import { geocodeTripStopTool } from './geocode-trip-stop';
import {
  commitBookingTool,
  guestClaimLinkTool,
  logAgentActionTool,
  prefundTripTool,
  reserveBookingTool,
} from './guest-escrow';
import { quoteFxTool } from './quote-fx';
import { rateAgentTool } from './rate-agent';
import { recommendRestaurantsTool } from './recommend-restaurants';
import { searchFlightsTool } from './search-flights';
import { searchHotelsTool } from './search-hotels';
import { sendTokensTool } from './send-tokens';
import { settleBookingTool } from './settle-booking';
import { settleSplitTool } from './settle-split';
import { swapAndBridgeTool } from './swap-and-bridge';
import { swapTokensTool } from './swap-tokens';
import { timezoneBriefTool } from './timezone-brief';
import { travelSafetyAidTool } from './travel-safety-aid';
import { tripWeatherBriefTool } from './trip-weather-brief';
import type { ToolDef } from './types';
import { validateTravelAddressTool } from './validate-travel-address';

export {
  type AirQualityBriefInput,
  type AirQualityBriefResult,
  airQualityBrief,
  airQualityBriefTool,
} from './air-quality-brief';
export { cancelBookingTool } from './cancel-booking';
export { confirmDuffelTool } from './confirm-duffel';
export {
  type ElevationRiskBriefInput,
  type ElevationRiskBriefResult,
  elevationRiskBrief,
  elevationRiskBriefTool,
} from './elevation-risk-brief';
export {
  type ExportRouteMapInput,
  type ExportRouteMapResult,
  exportRouteMap,
  exportRouteMapTool,
} from './export-route-map';
export {
  type FaucetChain,
  type FaucetDripArgs,
  type FaucetDripResult,
  type FaucetToken,
  faucetDripTool,
  requestFaucetDrip,
} from './faucet';
export { generateBookingInvoiceTool } from './generate-booking-invoice';
export {
  type GeocodeTripStopInput,
  type GeocodeTripStopResult,
  geocodeTripStop,
  geocodeTripStopTool,
} from './geocode-trip-stop';
// Re-export individual tool defs so API routes + workflow steps can
// import a single tool without walking the full registry.
export {
  commitBookingTool,
  guestClaimLinkTool,
  logAgentActionTool,
  prefundTripTool,
  reserveBookingTool,
} from './guest-escrow';
export {
  type RecommendRestaurantsInput,
  type RecommendRestaurantsResult,
  type RestaurantAddressComponent,
  type RestaurantPlace,
  recommendRestaurants,
  recommendRestaurantsTool,
} from './recommend-restaurants';
export { settleBookingTool } from './settle-booking';
export {
  type TimezoneBriefInput,
  type TimezoneBriefResult,
  timezoneBrief,
  timezoneBriefTool,
} from './timezone-brief';
export {
  type TravelSafetyAidInput,
  type TravelSafetyAidResult,
  travelSafetyAid,
  travelSafetyAidTool,
} from './travel-safety-aid';
export {
  type TripWeatherBriefInput,
  type TripWeatherBriefResult,
  tripWeatherBrief,
  tripWeatherBriefTool,
} from './trip-weather-brief';
export type { JsonSchemaObject, ToolContext, ToolDef } from './types';
export {
  type ValidateTravelAddressInput,
  type ValidateTravelAddressResult,
  validateTravelAddress,
  validateTravelAddressTool,
} from './validate-travel-address';

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
  generateBookingInvoiceTool,
  logAgentActionTool,
  // Concierge / in-trip companion
  geocodeTripStopTool,
  tripWeatherBriefTool,
  airQualityBriefTool,
  validateTravelAddressTool,
  timezoneBriefTool,
  elevationRiskBriefTool,
  travelSafetyAidTool,
  recommendRestaurantsTool,
  exportRouteMapTool,
  // Ops helpers
  faucetDripTool,
];

/** Keyed registry for O(1) lookup by name. */
export const tools: Record<string, ToolDef> = Object.fromEntries(toolList.map(t => [t.name, t]));
