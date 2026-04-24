# @sendero/sherpa

TypeScript client for [Sherpa's Requirements API v3](https://docs.joinsherpa.io/requirements-api/). The vendored Swagger 2.0 spec is the single source of truth for wire shapes — `src/types.ts` mirrors it, `src/client.ts` implements it.

## Layout

```
sendero-sherpa/
├── openapi/
│   └── sherpa-requirements-api-v3.json    ← upstream spec, treat as authoritative
├── src/
│   ├── types.ts                            ← TypeScript view of the spec
│   ├── client.ts                           ← REST client + normalize()
│   └── index.ts                            ← public exports
└── README.md                               (this file)
```

When Sherpa rev's the API, diff the vendored JSON against the upstream spec at `https://docs.joinsherpa.io/requirements-api/api-reference.html` and regenerate the types. The JSON stays authoritative; the TypeScript types are a convenience view.

## Wire summary

```
POST https://requirements-api.joinsherpa.com/v3/trips
     ?include=restriction,procedure
     [&utm_source=…&utm_medium=…&utm_campaign=…&utm_term=…&utm_content=…]
x-api-key: ${SHERPA_API_KEY}
content-type: application/vnd.api+json
accept:       application/vnd.api+json

{
  "data": {
    "type": "TRIP",
    "attributes": {
      "locale": "en-US",
      "currency": "USD",
      "travelNodes": [
        { "type": "ORIGIN",      "locationCode": "BRA", "airportCode": "GRU",
          "departure": { "date": "2026-06-01", "travelMode": "AIR" } },
        { "type": "DESTINATION", "locationCode": "USA", "airportCode": "JFK",
          "arrival":   { "date": "2026-06-01", "travelMode": "AIR" } }
      ],
      "traveller": {
        "passports":     ["BRA"],
        "travelPurposes": ["BUSINESS"]
      }
    }
  }
}
```

Response is JSON:API (`data.attributes.categories[]` + `data.relationships.procedures|restrictions` + flat `included[]` of `PROCEDURE` / `RESTRICTION` entities). Each entity carries `actions[]` where `intent === 'apply-product'` entries expose a full `Product` shape (price, breakdown, deadline) — **this is the hook for the in-booking visa-ancillary CTA**.

## Env

| Var                       | Default                                       | Purpose                                                   |
| ------------------------- | --------------------------------------------- | --------------------------------------------------------- |
| `SHERPA_API_KEY`          | (unset ⇒ fallback to curated rules)            | Partner key from [docs.joinsherpa.io](https://docs.joinsherpa.io) |
| `SHERPA_API_BASE_URL`     | `https://requirements-api.joinsherpa.com`      | Override for mocks / mitm                                 |
| `SHERPA_API_TIMEOUT_MS`   | `4500`                                         | Per-call deadline                                         |
| `SHERPA_WEBHOOK_SECRET`   | —                                              | Shared secret for inbound webhook validation              |

## Graceful-fallback contract

Every call returns `{ ok: true, data } | { ok: false, reason, message }` where `reason ∈ { no_key | timeout | network | http_error | parse_error }`. Callers (the trip-eligibility runner in `@sendero/vault`) never throw on a Sherpa failure — they overlay the response when `ok`, or fall back to the curated corridor table in `@sendero/vault/visa-rules` when not. The booking flow is never halted by an external provider.

## UTM attribution

Pass `utm` on `postTrips({ attributes, utm })` and Sherpa merges the values onto `redirect.url` on every trip-level + category-level deep link. Use it to attribute "See details" clicks back to the booking surface they came from.

## License notes

The vendored OpenAPI spec at `openapi/sherpa-requirements-api-v3.json` is Sherpa's intellectual property, imported here as a direct wire-shape reference under their developer-terms license ("Proprietary. All rights reserved."). Do not distribute outside this repo.
