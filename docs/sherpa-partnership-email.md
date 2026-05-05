# Sherpa partnership outreach

Send to: `info@joinsherpa.com` (head office, primary), CC `hello@joinsherpa.com` (general).
Skip `pr@joinsherpa.com` — press only.

Subject options (pick one):
- **Sendero × sherpa° — embedding entry requirements + eVisa into our travel agent platform**
- **API access request — integration ready, requesting sandbox credentials**
- **Partner inquiry — multi-tenant travel agent built around sherpa° Requirements API**

---

## Email body

> Hi sherpa° team,
>
> I'm Tomas, founder of Sendero (https://sendero.travel). We're building an AI travel-agent platform that travel agencies and corporate travel offices use to plan, book, and manage trips for their clients on WhatsApp + Slack + web. We're already integrated with Duffel for flights + stays and eSIM Go for travel data.
>
> **Entry requirements + eVisa is the next surface, and we'd like sherpa° as the partner.** We've already built the integration against your public OpenAPI v3 spec — typed client, webhook receiver, and trip-eligibility model are committed in our codebase. We just need API credentials to flip from mock to live.
>
> **Why sherpa° specifically:**
> - Coverage and freshness — entry requirements, visa rules, health/COVID-era residue, and transit rules from one canonical source beats stitching together gov sites.
> - eVisa application flow — lets us close the loop inside the WhatsApp agent rather than handing travelers off.
> - Modern API + webhook lifecycle — fits cleanly next to our Duffel + eSIM Go architecture.
> - Brand fit — your B2B partner roster is the same segment we target (TMCs, OTAs, mid-market agencies).
>
> **What we'd be embedding:**
> - `check_trip_eligibility` — call your Requirements API after a flight is searched OR booked; surface entry requirements + visa needs in the agent reply (WhatsApp, Slack, web).
> - `start_evisa_application` — kick off eVisa flows from the agent when a destination requires one.
> - Webhook receiver for requirement changes / application lifecycle (already built at `/api/webhooks/sherpa`).
>
> **Volume signals:**
> - ~XX active travel agencies onboarded *(TODO: replace before sending)*
> - ~XX international flight bookings/month routed through our agent *(TODO)*
> - Average international trip value: ~$X,XXX *(TODO)*
> - Pricing model on our side: tenant agencies set their own agency markup; Sendero takes a small protocol fee. Standard wholesale/commission terms work for us.
>
> **What we need to get started:**
> 1. Sandbox API key + access to the production Requirements API.
> 2. eVisa product enablement (which corridors are live).
> 3. Standard partner contract terms — pricing structure, DPA, branding requirements.
> 4. Webhook signing scheme (we'd like to verify inbound updates).
> 5. A 30-min call to walk through the integration and answer any questions.
>
> Integration is ready — we can be in sandbox the same week credentials land, and end-to-end live shortly after contract terms close. Happy to share our security/DPA pack on request.
>
> Thanks — looking forward to hearing back.
>
> Tomas
> Sendero | tomas@sendero.travel

---

## TODOs before sending

- [ ] Replace the three `(TODO:…)` volume placeholders.
- [ ] Confirm `info@joinsherpa.com` is still the right inbox (their site shows it under Head Office).
- [ ] If sherpa° has a "Become a Partner" form on the site, fill that AND email — both surfaces get logged.
- [ ] Set a 5-business-day reminder. If no response, escalate via LinkedIn DM to a sherpa° BD/partnerships hire (search "Sherpa" + "Partnerships").

## Backup partners (queue if sherpa° is slow)

| Partner | Inbox | Rationale |
|---|---|---|
| Timatic (IATA) | via IATA partner portal | Authoritative source; airlines trust it; harder onboarding |
| VisaHQ API | `partnerships@visahq.com` | Stronger eVisa processing; weaker on transit/entry rules |
| iVisa | via iVisa partner form | Consumer-facing brand, programmatic API, fastest onboarding |
