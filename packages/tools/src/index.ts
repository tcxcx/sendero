import { airQualityBriefTool } from './air-quality-brief';
import { airportArrivalPlaybookTool } from './airport-arrival-playbook';
import { airportTransferCoordinatorTool } from './airport-transfer-coordinator';
import { bookFlightTool } from './book-flight';
import { bookStayTool } from './book-stay';
import { bridgeToArcTool } from './bridge-to-arc';
import { cancelBookingTool } from './cancel-booking';
import { cancelOrderQuoteTool, confirmCancelOrderTool } from './cancel-order-quote';
import { checkPolicyTool } from './check-policy';
import { checkTreasuryTool } from './check-treasury';
import { confirmDuffelTool } from './confirm-duffel';
import { displayOfferConditionsTool } from './display-offer-conditions';
import { elevationRiskBriefTool } from './elevation-risk-brief';
import { ensureDuffelCustomerTool } from './ensure-duffel-customer';
import { exportRouteMapTool } from './export-route-map';
import { faucetDripTool } from './faucet';
import { findAirportsNearbyTool } from './find-airports-nearby';
import { listAirlineCreditsTool } from './list-airline-credits';
import { listFlightAncillariesTool } from './list-flight-ancillaries';
import { gatewayBalanceTool } from './gateway-balance';
import { manageStaysNegotiatedRateTool } from './manage-stays-negotiated-rate';
import { quoteStayTool } from './quote-stay';
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
import { restaurantRouteCardTool } from './restaurant-route-card';
import { searchFlightsTool } from './search-flights';
import { searchHotelsTool } from './search-hotels';
import { sendTokensTool } from './send-tokens';
import { settleBookingTool } from './settle-booking';
import { settleSplitTool } from './settle-split';
import { swapAndBridgeTool } from './swap-and-bridge';
import { swapTokensTool } from './swap-tokens';
import { timezoneBriefTool } from './timezone-brief';
import { travelSafetyAidTool } from './travel-safety-aid';
import { tripCheckinReminderTool } from './trip-checkin-reminder';
import { tripDelayReplannerTool } from './trip-delay-replanner';
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
export {
  type AirportArrivalPlaybookInput,
  type AirportArrivalPlaybookResult,
  airportArrivalPlaybook,
  airportArrivalPlaybookTool,
} from './airport-arrival-playbook';
export {
  type AirportTransferCoordinatorInput,
  type AirportTransferCoordinatorResult,
  airportTransferCoordinator,
  airportTransferCoordinatorTool,
} from './airport-transfer-coordinator';
export {
  type RestaurantRouteCardInput,
  type RestaurantRouteCardResult,
  restaurantRouteCard,
  restaurantRouteCardTool,
} from './restaurant-route-card';
export {
  type TripCheckinReminderInput,
  type TripCheckinReminderResult,
  tripCheckinReminder,
  tripCheckinReminderTool,
} from './trip-checkin-reminder';
export {
  type TripDelayReplannerInput,
  type TripDelayReplannerResult,
  tripDelayReplanner,
  tripDelayReplannerTool,
} from './trip-delay-replanner';
export {
  type EnsureDuffelCustomerInput,
  type EnsureDuffelCustomerResult,
  ensureDuffelCustomer,
  ensureDuffelCustomerTool,
} from './ensure-duffel-customer';
export {
  type ListFlightAncillariesInput,
  type ListFlightAncillariesResult,
  type AncillaryBagOption,
  type AncillaryCfarOption,
  type AncillarySeatOption,
  listFlightAncillaries,
  listFlightAncillariesTool,
} from './list-flight-ancillaries';
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
  // Composed concierge + ops artifacts
  restaurantRouteCardTool,
  airportTransferCoordinatorTool,
  airportArrivalPlaybookTool,
  tripCheckinReminderTool,
  tripDelayReplannerTool,
  // Duffel identity + ancillaries (trip-lifecycle extras)
  ensureDuffelCustomerTool,
  listFlightAncillariesTool,
  // Duffel advanced flows (air + stays + credits + conditions + places)
  findAirportsNearbyTool,
  displayOfferConditionsTool,
  quoteStayTool,
  bookStayTool,
  cancelOrderQuoteTool,
  confirmCancelOrderTool,
  listAirlineCreditsTool,
  manageStaysNegotiatedRateTool,
  // Ops helpers
  faucetDripTool,
];

/** Keyed registry for O(1) lookup by name. */
export const tools: Record<string, ToolDef> = Object.fromEntries(toolList.map(t => [t.name, t]));
