import { activatePricingPolicyTool } from './activate-pricing-policy';
import { airQualityBriefTool } from './air-quality-brief';
import { airportArrivalPlaybookTool } from './airport-arrival-playbook';
import { airportTransferCoordinatorTool } from './airport-transfer-coordinator';
import { bookEsimTool } from './book-esim';
import { getActiveTripTool } from './get-active-trip';
import { getTripBriefTool } from './get-trip-brief';
import { reportKnowledgeGapTool } from './report-knowledge-gap';
import { listAvailableToolsTool } from './list-available-tools';
import { recallSimilarTurnsTool } from './recall-similar-turns';
import { findResolvedGapTool } from './find-resolved-gap';
import { hobbyProfileBuilderTool } from './anticipation/hobby-profile-builder';
import { cityBucketListManagerTool } from './anticipation/city-bucket-list-manager';
import { setHomeIataTool } from './set-home-iata';
import { setTripKindTool } from './set-trip-kind';
import { sweepDcwToGatewayTool } from './sweep-dcw-to-gateway';
import { takeMeHomeTool } from './take-me-home';
import { bookFlightTool } from './book-flight';
import { selectSeatTool } from './select-seat';
import { addBaggageTool } from './add-baggage';
import { bookStayTool } from './book-stay';
import { searchEsimTool } from './search-esim';
import { bridgeToArcTool } from './bridge-to-arc';
import { cancelBookingTool } from './cancel-booking';
import { cancelOrderQuoteTool, confirmCancelOrderTool } from './cancel-order-quote';
import {
  confirmOrderChangeTool,
  requestOrderChangeTool,
  selectOrderChangeOfferTool,
} from './order-change-quote';
import { checkPolicyTool } from './check-policy';
import { checkTreasuryTool } from './check-treasury';
import { confirmBookingTool } from './confirm-booking';
import { confirmFlightTool } from './confirm-flight';
import { createPassengerTool } from './create-passenger';
import { createTripTool } from './create-trip';
import { displayOfferConditionsTool } from './display-offer-conditions';
import {
  addPassengerToGroupTripTool,
  broadcastToGroupTripTool,
  claimGroupSeatTool,
  createGroupTripTool,
  removePassengerFromGroupTripTool,
  removePassengerTool,
  setGroupBroadcastOptoutTool,
} from './group-trips';
export {
  addPassengerToGroupTripTool,
  broadcastToGroupTripTool,
  claimGroupSeatTool,
  createGroupTripTool,
  removePassengerFromGroupTripTool,
  removePassengerTool,
  setGroupBroadcastOptoutTool,
} from './group-trips';
import { elevationRiskBriefTool } from './elevation-risk-brief';
import { ensureFlightCustomerTool } from './ensure-flight-customer';
import { exportRouteMapTool } from './export-route-map';
import { faucetDripTool } from './faucet';
import { findAirportsNearbyTool } from './find-airports-nearby';
import { mintStampTool, refreshStampUriTool } from './mint-stamp';
import { moonpayTopupTool } from './moonpay-topup';
import { getMoonpayTopupStatusTool } from './get-moonpay-topup-status';
import { moonpayOfframpTool } from './moonpay-offramp';
import { getMoonpayOfframpStatusTool } from './get-moonpay-offramp-status';
import { completeTripTool } from './complete-trip';
import { demoMintBoardingPassTool } from './demo-mint-boarding-pass';
import {
  kapsoActivatePhoneNumberTool,
  kapsoListNumbersTool,
  kapsoReserveNumberTool,
  kapsoSendTestMessageTool,
  kapsoSubmitMessageTemplatesTool,
  kapsoUpdateBusinessProfileTool,
} from './kapso-channel';
import { listAirlineCreditsTool } from './list-airline-credits';
import { listFlightAncillariesTool } from './list-flight-ancillaries';
import { gatewayBalanceTool, travelerBalanceTool, treasuryBalanceTool } from './gateway-balance';
import { prepareTravelerSigninTool } from './prepare-traveler-signin';
import {
  requestLocationTool,
  requestPhoneNumberTool,
  sendCtaUrlMessageTool,
  sendDocumentMessageTool,
  sendFlowMessageTool,
  sendImageMessageTool,
  sendInteractiveButtonsTool,
  sendInteractiveListTool,
} from './whatsapp-interactive';
import { listStayRatesTool } from './list-stay-rates';
import { manageStaysNegotiatedRateTool } from './manage-stays-negotiated-rate';
import { quoteStayTool } from './quote-stay';
import { gatewayTransferTool } from './gateway-transfer';
import { generateBookingInvoiceTool } from './generate-booking-invoice';
import { geocodeTripStopTool } from './geocode-trip-stop';
import { getPricingPolicyTool } from './get-pricing-policy';
import {
  commitBookingTool,
  guestClaimLinkTool,
  logAgentActionTool,
  prefundTripTool,
  reserveBookingTool,
} from './guest-escrow';
import { quoteFxTool } from './quote-fx';
import { giveFeedbackTool } from './give-feedback';
import { readReputationTool } from './read-reputation';
import { readValidationTool } from './read-validation';
import { requestValidationTool } from './request-validation';
import { submitValidationResponseTool } from './submit-validation-response';
import { recommendRestaurantsTool } from './recommend-restaurants';
import { restaurantRouteCardTool } from './restaurant-route-card';
import { checkTravelEligibilityTool } from './check-travel-eligibility';
import { scanDocumentTool } from './scan-document';
import { scanDocumentAutoTool } from './scan-document-auto';
import { scanPassportInlineTool } from './scan-passport-inline';
import { checkVisaRequirementsTool } from './check-visa-requirements';
import { recommendVisaApplicationPathTool } from './recommend-visa-application-path';
import { searchFlightsTool } from './search-flights';
import { searchHotelsTool } from './search-hotels';
import { sendPayLinkTool } from './send-pay-link';
import { sendTokensTool } from './send-tokens';
import {
  slackCheckInstallTool,
  slackInviteBotToChannelsTool,
  slackListWorkspaceChannelsTool,
  slackPersistChannelRoutesTool,
  slackSendTestMessageTool,
  slackStartOauthInstallTool,
} from './slack-channel';
import { requestHumanHandoffTool } from './request-human-handoff';
import { sendWhatsAppTemplateTool } from './send-whatsapp-template';
import { settleBookingTool } from './settle-booking';
import { settleSplitTool } from './settle-split';
import { swapAndBridgeTool } from './swap-and-bridge';
import { swapTokensTool } from './swap-tokens';
import { timezoneBriefTool } from './timezone-brief';
import { travelSafetyAidTool } from './travel-safety-aid';
import { tripCheckinReminderTool } from './trip-checkin-reminder';
import { tripDelayReplannerTool } from './trip-delay-replanner';
import { tripWeatherBriefTool } from './trip-weather-brief';
import { currencyConvertTool } from './currency-convert';
import { webSearchTool } from './web-search';
import { lookupMatchFixturesTool } from './lookup-match-fixtures';
import { saveTravelerPreferenceTool } from './save-traveler-preference';
import { gatewayTxHistoryTool } from './gateway-tx-history';
import { tippingEtiquetteTool } from './tipping-etiquette';
import { localColorBriefTool } from './local-color-brief';
export {
  localColorBrief,
  type LocalColorBriefInput,
  type LocalColorBriefResult,
} from './local-color-brief';
import type { ToolDef } from './types';
import { validateTravelAddressTool } from './validate-travel-address';

export {
  type AirQualityBriefInput,
  type AirQualityBriefResult,
  airQualityBrief,
  airQualityBriefTool,
} from './air-quality-brief';
export { cancelBookingTool } from './cancel-booking';
export {
  bookStay,
  type BookStayInput,
  type BookStayResult,
  type StayBookingConfirmationPayload,
} from './book-stay';
export { bookStayTool };
export {
  confirmBookingTool,
  runConfirmBooking,
  dbDependencies as confirmBookingDbDependencies,
  type ConfirmBookingDeps,
  type ConfirmBookingInput,
  type ConfirmBookingOutput,
  PolicyInactiveError,
  PolicyMissingKindError,
  MarkupOverCeilingError,
  MarkupUnderFloorError,
  MarkupUnderTakeFloorError,
  OverrideRequiresScopeError,
  OverrideUnnecessaryError,
  TreasuryAddressMissingError,
} from './confirm-booking';
export {
  getPricingPolicyTool,
  runGetPricingPolicy,
  dbDependencies as getPricingPolicyDbDependencies,
  type GetPricingPolicyDeps,
  type GetPricingPolicyInput,
  type GetPricingPolicyOutput,
  type PolicyRow,
  type PolicyStatus,
  TenantContextMissingError as GetPricingPolicyTenantMissingError,
} from './get-pricing-policy';
export {
  activatePricingPolicyTool,
  runActivatePricingPolicy,
  dbDependencies as activatePricingPolicyDbDependencies,
  type ActivatePricingPolicyDeps,
  type ActivatePricingPolicyInput,
  type ActivatePricingPolicyOutput,
  TenantContextMissingError as ActivatePricingPolicyTenantMissingError,
  OperatorOnlyError,
  TreasuryNotProvisionedError,
  MarkupConfigInvalidError,
  PolicyVersionConflictError,
} from './activate-pricing-policy';
export { confirmFlightTool } from './confirm-flight';
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
  confirmOrderChangeTool,
  requestOrderChangeTool,
  selectOrderChangeOfferTool,
} from './order-change-quote';
export { checkTravelEligibilityTool } from './check-travel-eligibility';
export type { OpenApiDocInput } from './openapi';
export { buildOpenApiDoc } from './openapi';
export { checkTreasuryTool } from './check-treasury';
export { scanDocumentTool } from './scan-document';
export { scanDocumentAutoTool } from './scan-document-auto';
export { scanPassportInlineTool } from './scan-passport-inline';
export { checkVisaRequirementsTool } from './check-visa-requirements';
export {
  type RecommendVisaApplicationPathInput,
  type RecommendVisaApplicationPathResult,
  type ConsularOption,
  recommendVisaApplicationPath,
  recommendVisaApplicationPathTool,
} from './recommend-visa-application-path';
export type { KeyScope } from './scopes';
export {
  DEFAULT_PROD_SCOPES,
  filterPublicTools,
  hasScope,
  isPublicTool,
  KEY_SCOPES,
  PRIVILEGED_TOOLS,
  requiresSignature,
  SANDBOX_SCOPES,
  toolToScope,
} from './scopes';
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
  type EnsureFlightCustomerInput,
  type EnsureFlightCustomerResult,
  ensureFlightCustomer,
  ensureFlightCustomerTool,
} from './ensure-flight-customer';
export {
  type ListFlightAncillariesInput,
  type ListFlightAncillariesResult,
  type AncillaryBagOption,
  type AncillaryCfarOption,
  type AncillarySeatOption,
  listFlightAncillaries,
  listFlightAncillariesTool,
} from './list-flight-ancillaries';
export {
  type SelectSeatInput,
  type SelectSeatResult,
  type SelectSeatDeps,
  TripNotFoundError as SelectSeatTripNotFoundError,
  runSelectSeat,
  selectSeatTool,
} from './select-seat';
export {
  type AddBaggageInput,
  type AddBaggageResult,
  type AddBaggageDeps,
  TripNotFoundError as AddBaggageTripNotFoundError,
  runAddBaggage,
  addBaggageTool,
} from './add-baggage';
export { sendPayLinkTool } from './send-pay-link';
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
  type TripWeatherForecastDay,
  tripWeatherBrief,
  tripWeatherBriefTool,
} from './trip-weather-brief';
export {
  type CurrencyConvertInput,
  type CurrencyConvertResult,
  currencyConvert,
  currencyConvertTool,
} from './currency-convert';
export {
  type WebSearchInput,
  type WebSearchResult,
  type WebSearchSource,
  webSearchTool,
} from './web-search';
export {
  type LookupMatchFixturesInput,
  type LookupMatchFixturesResult,
  type FixtureRow,
  lookupMatchFixturesTool,
} from './lookup-match-fixtures';
export {
  type SaveTravelerPreferenceInput,
  type SaveTravelerPreferenceResult,
  saveTravelerPreferenceTool,
} from './save-traveler-preference';
export {
  type GatewayTxHistoryInput,
  type GatewayTxHistoryResult,
  type TxHistoryEntry,
  type TxKind,
  type TxStatus,
  gatewayTxHistoryTool,
} from './gateway-tx-history';
export {
  type TippingEtiquetteInput,
  type TippingEtiquetteResult,
  type TippingScenario,
  TIPPING_SCENARIOS,
  TippingCountryUnknownError,
  tippingEtiquette,
  tippingEtiquetteTool,
} from './tipping-etiquette';
export {
  type GetActiveTripInput,
  type GetActiveTripResult,
  getActiveTrip,
  getActiveTripTool,
} from './get-active-trip';
export {
  type GetTripBriefInput,
  type GetTripBriefResult,
  type GetTripBriefDeps,
  type TripBriefSection,
  type FlightBookingSummary,
  type StayBookingSummary,
  type EsimSummary as TripBriefEsimSummary,
  type TripBriefAlert,
  type TripBriefHeader,
  runGetTripBrief,
  dbDependencies as getTripBriefDbDependencies,
  getTripBriefTool,
} from './get-trip-brief';
export {
  type ReportKnowledgeGapInput,
  type ReportKnowledgeGapResult,
  type ReportKnowledgeGapDeps,
  runReportKnowledgeGap,
  dbDependencies as reportKnowledgeGapDbDependencies,
  reportKnowledgeGapTool,
} from './report-knowledge-gap';
export {
  type ListAvailableToolsInput,
  type ListAvailableToolsResult,
  type ListAvailableToolsDeps,
  type ListedTool,
  runListAvailableTools,
  listAvailableToolsTool,
} from './list-available-tools';
export {
  type RecallSimilarTurnsInput,
  type RecallSimilarTurnsResult,
  type RecallSimilarTurnsDeps,
  runRecallSimilarTurns,
  recallSimilarTurnsTool,
} from './recall-similar-turns';
export {
  type FindResolvedGapInput,
  type FindResolvedGapResult,
  type FindResolvedGapDeps,
  runFindResolvedGap,
  findResolvedGapTool,
} from './find-resolved-gap';
export {
  type HobbyProfileBuilderInput,
  type HobbyProfileBuilderResult,
  type HobbyProfileBuilderDeps,
  type TravelerTasteGraph,
  runHobbyProfileBuilder,
  normalizeHobbyKey,
  hobbyProfileBuilderTool,
} from './anticipation/hobby-profile-builder';
export {
  type CityBucketListManagerInput,
  type CityBucketListManagerResult,
  type CityBucketListManagerDeps,
  runCityBucketListManager,
  cityBucketListManagerTool,
} from './anticipation/city-bucket-list-manager';
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
  treasuryBalanceTool,
  travelerBalanceTool,
  prepareTravelerSigninTool,
  gatewayTransferTool,
  swapTokensTool,
  sendTokensTool,
  bridgeToArcTool,
  swapAndBridgeTool,
  settleSplitTool,
  checkPolicyTool,
  quoteFxTool,
  // ERC-8004 reputation + validation (replaces the in-memory rate_agent mock)
  giveFeedbackTool,
  readReputationTool,
  requestValidationTool,
  submitValidationResponseTool,
  readValidationTool,
  // Guest escrow — prefund-then-share (Peanut-style)
  prefundTripTool,
  guestClaimLinkTool,
  reserveBookingTool,
  commitBookingTool,
  confirmBookingTool,
  confirmFlightTool,
  settleBookingTool,
  cancelBookingTool,
  // Wallet flow — pay-link dispatch (Step 5 agent surface)
  sendPayLinkTool,
  generateBookingInvoiceTool,
  // MoonPay fiat → USDC top-up. `moonpay_topup` mints a signed
  // checkout URL + QR + /me/wallet deep-link; `get_moonpay_topup_status`
  // reads recent attempts so the agent can confirm completion before
  // retrying a stalled booking.
  moonpayTopupTool,
  getMoonpayTopupStatusTool,
  moonpayOfframpTool,
  getMoonpayOfframpStatusTool,
  completeTripTool,
  // Tenant pricing policy agent surface (E1 + E2)
  getPricingPolicyTool,
  activatePricingPolicyTool,
  logAgentActionTool,
  // Concierge / in-trip companion
  geocodeTripStopTool,
  tripWeatherBriefTool,
  airQualityBriefTool,
  validateTravelAddressTool,
  timezoneBriefTool,
  elevationRiskBriefTool,
  travelSafetyAidTool,
  // Free-API utilities — no partner contracts, no auth.
  currencyConvertTool,
  webSearchTool,
  lookupMatchFixturesTool,
  saveTravelerPreferenceTool,
  gatewayTxHistoryTool,
  tippingEtiquetteTool,
  recommendRestaurantsTool,
  exportRouteMapTool,
  // Composed concierge + ops artifacts
  localColorBriefTool,
  restaurantRouteCardTool,
  airportTransferCoordinatorTool,
  airportArrivalPlaybookTool,
  tripCheckinReminderTool,
  tripDelayReplannerTool,
  // Supplier identity + ancillaries (trip-lifecycle extras)
  ensureFlightCustomerTool,
  listFlightAncillariesTool,
  // Pre-booking ancillary staging — `select_seat` and `add_baggage`
  // stash selections in `Trip.metadata.pendingAncillaries` for
  // `book_flight` to forward to Duffel as services[]. Post-confirmation
  // changes use the order_change flow (P2).
  selectSeatTool,
  addBaggageTool,
  // Advanced flight flows (air + stays + credits + conditions + places)
  findAirportsNearbyTool,
  displayOfferConditionsTool,
  listStayRatesTool,
  quoteStayTool,
  bookStayTool,
  // Travel ancillaries (eSIM, future: card issuance) — share the same
  // TenantPricingPolicy + senderoTake legs as bookings.
  searchEsimTool,
  bookEsimTool,
  // Trip context resolver — agents call this at thread-start so
  // downstream tools (book_esim, complete_trip, weather, etc.) always
  // have the right tripId / destination ISO-2 / dates regardless of
  // how many interactive cards have scrolled past in the WhatsApp
  // conversation history.
  getActiveTripTool,
  // Single-call canonical recap of an entire trip — flights + stays +
  // eSIMs + alerts + a public share URL. Replaces the agent stitching
  // get_active_trip + list_flight_ancillaries + esim status by hand.
  getTripBriefTool,
  // Demand-driven observability — the agent's own bug tracker.
  // Both tools are dev/sandbox-only at the handler level (production
  // prod-keys get a refusal). `report_knowledge_gap` self-reports
  // missing tools/instructions/env; `list_available_tools` lets the
  // agent introspect the catalog when uncertain. See
  // packages/tools/src/report-knowledge-gap.ts and
  // scripts/scan-knowledge-gaps.ts (`bun gaps:scan`).
  reportKnowledgeGapTool,
  listAvailableToolsTool,
  // Demand-driven recall — agent reads its own past Phoenix traces
  // BEFORE planning. Same dev-only gate as report_knowledge_gap.
  // Spec: docs/specs/arize-phoenix-integration.md §4.3.
  recallSimilarTurnsTool,
  // Self-heal — agent checks `sendero-resolved-gaps` Phoenix dataset
  // BEFORE calling report_knowledge_gap. If a prior fix exists, apply
  // and retry; if not, escalate normally. The hackathon-bonus piece.
  // Spec: docs/specs/arize-phoenix-integration.md §4.3 PR3.
  findResolvedGapTool,
  // Anticipation HP1 — Hobby-Aware Concierge taste-graph foundation.
  // Both `experimental: true` + dev-only gate at handler-time.
  // Spec: docs/specs/anticipatory-concierge.md §4.0 HP1 + Appendix A.4.
  hobbyProfileBuilderTool,
  cityBucketListManagerTool,
  // Phase B.2 — "trip buddy" digital-nomad concierge. `take_me_home`
  // resolves the cheapest return flight from the traveler's current
  // location to their declared home; `set_home_iata` persists the
  // home anchor so subsequent journeys resolve without re-asking.
  takeMeHomeTool,
  setHomeIataTool,
  // Phase F — `set_trip_kind` flips a trip's kind enum. Used by the
  // wrap-up prompt's "Still traveling" button to upgrade a trip to
  // open_journey (digital-nomad mode) without re-creating it.
  setTripKindTool,
  // Manual DCW → Gateway sweep — recovery path for funds that landed
  // at the traveler's DCW on a chain where Sendero never registered
  // the Wallet row with Circle (e.g. MoonPay sandbox forces Sepolia
  // and we don't pre-provision DCWs on every Gateway EVM chain yet).
  sweepDcwToGatewayTool,
  cancelOrderQuoteTool,
  confirmCancelOrderTool,
  requestOrderChangeTool,
  selectOrderChangeOfferTool,
  confirmOrderChangeTool,
  listAirlineCreditsTool,
  manageStaysNegotiatedRateTool,
  // Ops helpers
  faucetDripTool,
  // Inbox seeding — create a passenger row (User) for testing the
  // MetaInbox; channel binding is optional so the agent can collect
  // phone/Slack id in a follow-up turn.
  createPassengerTool,
  // Trip primitives — open a regular Trip (lightweight), distinct
  // from prefund_trip (escrow + claim link).
  createTripTool,
  // Group trips — multi-passenger journeys with capacity ceilings.
  createGroupTripTool,
  addPassengerToGroupTripTool,
  claimGroupSeatTool,
  removePassengerFromGroupTripTool,
  removePassengerTool,
  // Operator → all passengers WhatsApp fan-out via Kapso broadcasts.
  broadcastToGroupTripTool,
  // Per-passenger opt-out toggle (stop / baja / basta keywords).
  setGroupBroadcastOptoutTool,
  // Multimodal OCR / document extraction
  scanDocumentTool,
  scanDocumentAutoTool,
  scanPassportInlineTool,
  checkVisaRequirementsTool,
  // Sendero intelligence layer on top of check_visa_requirements —
  // routed consulate recommendations + curated corridor notes for the
  // hard cases sherpa° doesn't auto-process (UK / US / Schengen consular).
  recommendVisaApplicationPathTool,
  checkTravelEligibilityTool,
  // Channel-provisioning (WhatsApp via Kapso, Slack OAuth + routing)
  kapsoListNumbersTool,
  kapsoReserveNumberTool,
  kapsoUpdateBusinessProfileTool,
  kapsoSubmitMessageTemplatesTool,
  kapsoActivatePhoneNumberTool,
  kapsoSendTestMessageTool,
  slackStartOauthInstallTool,
  slackCheckInstallTool,
  slackListWorkspaceChannelsTool,
  slackPersistChannelRoutesTool,
  slackInviteBotToChannelsTool,
  slackSendTestMessageTool,
  // NFT stamps (Arc-Testnet ERC-1155 souvenirs via Circle SCP template)
  mintStampTool,
  refreshStampUriTool,
  // Demo-only tool for the /demo trip console flow. Gated to envs where
  // NEXT_PUBLIC_DEMO_TRIP_ENABLED === 'true'. The agent can call this even
  // for users without a passkey wallet because it routes to org treasury.
  demoMintBoardingPassTool,
  // Human-in-the-loop escalation. Internal-only — never exposed to API
  // keys or MCP clients; the agent calls it when uncertain and the
  // operator answers in MetaInbox / trip inbox / `/dashboard/handoffs`.
  requestHumanHandoffTool,
  // Outbound HSM templates. Internal-only — the agent picks a template
  // when outside the 24-hour window or when a branded touch-point is
  // warranted (QUOTE_READY, BOOKING_CONFIRMED, CHECKIN_REMINDER, …).
  sendWhatsAppTemplateTool,
  // Native WhatsApp interactive UX — buttons, lists, image / document
  // sends, location + phone-number prompts. All internal-only.
  sendInteractiveButtonsTool,
  sendInteractiveListTool,
  sendImageMessageTool,
  sendDocumentMessageTool,
  sendCtaUrlMessageTool,
  sendFlowMessageTool,
  requestLocationTool,
  requestPhoneNumberTool,
];

/** Keyed registry for O(1) lookup by name. */
export const tools: Record<string, ToolDef> = Object.fromEntries(toolList.map(t => [t.name, t]));
