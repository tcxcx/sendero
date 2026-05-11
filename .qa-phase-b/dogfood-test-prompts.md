# Sendero Dogfood Test Prompts — 2026-05-08

One representative prompt per public-tool category. Coverage target: 101 public tools.
Paste any group into the WhatsApp sandbox (`+56 9 2040 3095`) or operator console.
Each prompt is a single message; let the agent finish before sending the next.

I'll watch the four armed monitors and tally which tool names land in `chat_messages.parts`.

---

## 1. Flights — search/book/ancillaries

```
DEVMODE find me the cheapest flight from EZE to UIO next Friday for one adult in economy
```
expected tools: `search_flights`, `display_offer_conditions`, `list_flight_ancillaries`

```
DEVMODE book the first option for traveler phone +593980668984
```
expected tools: `book_flight`, `confirm_booking`, `confirm_flight`, `settle_booking`, `generate_booking_invoice`

```
DEVMODE find airports near Mendoza Argentina within 200km
```
expected tools: `find_airports_nearby`

```
DEVMODE select seat 14A and add 1 bag for the most recent booking
```
expected tools: `select_seat`, `add_baggage`

```
DEVMODE I want to change my booking to next Sunday instead
```
expected tools: `request_order_change`, `select_order_change_offer`, `confirm_order_change`

```
DEVMODE cancel my last flight booking
```
expected tools: `cancel_order_quote`, `confirm_cancel_order`, `cancel_booking`

```
DEVMODE list my unused airline credits
```
expected tools: `list_airline_credits`

---

## 2. Hotels & eSIM

```
DEVMODE search hotels in Mendoza for Friday night, 2 guests
```
expected tools: `search_hotels`, `list_stay_rates`

```
DEVMODE quote and book the cheapest hotel option you found
```
expected tools: `quote_stay`, `book_stay`

```
DEVMODE I need an eSIM for 7 days in Argentina with 5GB data
```
expected tools: `search_esim`, `book_esim`

---

## 3. Wallet, treasury, MoonPay (the previously-broken set)

```
DEVMODE what's my wallet balance?
```
expected tools: `traveler_balance`

```
DEVMODE check the corporate treasury balance
```
expected tools: `check_treasury`

```
DEVMODE show my recent wallet activity
```
expected tools: `gateway_tx_history`

```
DEVMODE top up $50 USDC via MoonPay
```
expected tools: `moonpay_topup`, `get_moonpay_topup_status`

```
DEVMODE off-ramp $20 from my wallet to USD
```
expected tools: `moonpay_offramp`, `get_moonpay_offramp_status`

```
DEVMODE drip me 20 USDC from the testnet faucet
```
expected tools: `faucet_drip`

```
DEVMODE swap 10 USDC to EURC
```
expected tools: `swap_tokens`, `quote_fx`

```
DEVMODE bridge 50 USDC from Polygon into Arc
```
expected tools: `bridge_to_arc`, `swap_and_bridge`

```
DEVMODE convert 100 USD to ARS at today's rate
```
expected tools: `currency_convert`, `quote_fx`

---

## 4. Reputation & validation (ERC-8004)

```
DEVMODE read my reputation score
```
expected tools: `read_reputation`

```
DEVMODE rate Duffel Airways 5 stars for the last booking
```
expected tools: `give_feedback`

```
DEVMODE request validation that this trip happened from Sendero validators
```
expected tools: `request_validation`, `submit_validation_response`, `read_validation`

---

## 5. Concierge / destination intelligence

```
DEVMODE what's the weather like in Mendoza this Friday and Saturday?
```
expected tools: `trip_weather_brief`

```
DEVMODE give me an arrival playbook for landing at MDZ
```
expected tools: `airport_arrival_playbook`, `airport_transfer_coordinator`

```
DEVMODE recommend 3 parrillas near Plaza Independencia in Mendoza
```
expected tools: `recommend_restaurants`, `restaurant_route_card`

```
DEVMODE what's tipping etiquette in Argentina for a parrilla dinner?
```
expected tools: `tipping_etiquette`

```
DEVMODE give me a local color brief for Mendoza wine country
```
expected tools: `local_color_brief`

```
DEVMODE check air quality and elevation for Mendoza
```
expected tools: `air_quality_brief`, `elevation_risk_brief`, `timezone_brief`

```
DEVMODE export my current trip's route as a Google Maps link
```
expected tools: `export_route_map`

```
DEVMODE Is there any soccer match in Mendoza this weekend?
```
expected tools: `lookup_match_fixtures`

```
DEVMODE search the web for vegan restaurants in Mendoza
```
expected tools: `web_search`

---

## 6. Trip lifecycle

```
DEVMODE create a new trip to Mendoza for this weekend
```
expected tools: `create_trip`, `set_trip_kind`

```
DEVMODE what's my active trip?
```
expected tools: `get_active_trip`, `get_trip_brief`

```
DEVMODE take me home — book the cheapest return to my home airport
```
expected tools: `take_me_home`, `set_home_iata`

```
DEVMODE complete my current trip — I'm back home
```
expected tools: `complete_trip`

```
DEVMODE remind me about check-in for my next flight
```
expected tools: `trip_checkin_reminder`

```
DEVMODE my flight got delayed 4 hours — replan
```
expected tools: `trip_delay_replanner`

---

## 7. Group trips

```
DEVMODE create a group trip to Bariloche for 4 passengers
```
expected tools: `create_group_trip`, `add_passenger_to_group_trip`

```
DEVMODE broadcast a check-in reminder to everyone on my group trip
```
expected tools: `broadcast_to_group_trip`

---

## 8. Identity & documents

```
DEVMODE I have a passport image to scan — can you store it?
```
expected tools: `scan_passport_inline`, `scan_document`, `scan_document_auto`

```
DEVMODE do I need a visa to travel from Argentina to Japan?
```
expected tools: `check_visa_requirements`, `recommend_visa_application_path`

```
DEVMODE check if I'm eligible for my next trip
```
expected tools: `check_travel_eligibility`

```
DEVMODE create a passenger named María Fernández for inbox testing
```
expected tools: `create_passenger`

---

## 9. Policy / compliance / pricing

```
DEVMODE check this offer against our corporate policy: $4500 LATAM business class EZE-MIA
```
expected tools: `check_policy`

```
DEVMODE what's our active markup policy?
```
expected tools: `get_tenant_pricing_policy`, `activate_tenant_pricing_policy`

---

## 10. Identity & reputation reads

```
DEVMODE who operates this WhatsApp number?
```
expected tools: `get_operator_agency`

```
DEVMODE what's Sendero's agent identity on chain?
```
expected tools: `get_sendero_identity`

---

## 11. Logistics / address

```
DEVMODE validate this address: Av. San Martín 1234, Mendoza, Argentina
```
expected tools: `validate_travel_address`, `geocode_trip_stop`

```
DEVMODE plan a coordinated pickup at MDZ at 14:00 from the parrilla
```
expected tools: `airport_transfer_coordinator`

---

## 12. Settlement / on-chain (advanced — only if you want to exercise the rails)

```
DEVMODE pre-fund a $500 trip for my team
```
expected tools: `prefund_trip`, `reserve_booking`, `commit_booking`

```
DEVMODE settle the commission split for the last booking — 60/30/10
```
expected tools: `settle_split`

```
DEVMODE issue a pay-link for that pending booking
```
expected tools: `send_pay_link`, `guest_claim_link`

```
DEVMODE log this agent action on chain
```
expected tools: `log_agent_action`

---

## 13. Preferences

```
DEVMODE save my preference: aisle seat, vegetarian meal, no red-eye flights
```
expected tools: `save_traveler_preference`

```
DEVMODE save my home airport as EZE
```
expected tools: `set_home_iata`

---

## How I'll measure coverage

After each prompt, query:

```sql
SELECT toolName, COUNT(*)
FROM (
  SELECT jsonb_array_elements(parts)->>'toolName' AS toolName
  FROM chat_messages
  WHERE "createdAt" > now() - interval '120 minutes'
    AND parts IS NOT NULL
) sub
WHERE toolName IS NOT NULL
GROUP BY toolName
ORDER BY COUNT(*) DESC;
```

Or — once the edge worker rebuilds — call individual tools via Kapso and watch
`chat_messages` plus `whatsapp_outbound_messages` rows for delivery status.

Total tools targeted: **~80 unique** across 13 categories. Internal tools (185)
not exercised here — they're auth-gated to scope `*`.
