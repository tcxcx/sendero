# Faye partnership outreach

Send to: `partnerships@withfaye.com` (primary), CC `developers@withfaye.com` if it bounces.

Subject options (pick one):
- **Sendero × Faye — embedded travel insurance for our agent platform**
- **Partner inquiry — embedding Faye into a multi-tenant travel agent**

---

## Email body

> Hi Faye team,
>
> I'm Tomas, founder of Sendero (https://sendero.travel). We're building an AI travel-agent platform that travel agencies and corporate travel offices use to plan, book, and manage trips for their clients on WhatsApp + Slack + web. We're already integrated with Duffel for flights + stays and eSIM Go for travel data; insurance is the next ancillary on the roadmap and we'd like Faye to be the partner.
>
> **Why Faye specifically:**
> - Modern API (Bearer auth, JSON, webhooks) that fits our existing eSIM Go + Duffel architecture.
> - Mobile-first claims UX matches our WhatsApp-native agent.
> - Brand fits: our customers are mid-market travel agencies and corporate travel teams — same segment Faye targets directly.
>
> **What we'd be embedding:**
> - `search_insurance` — surface 3 tier options (Basic / Comprehensive / Premium) inside our WhatsApp agent right after a flight is booked.
> - `book_insurance` — issue policies via your API once the traveler picks a tier.
> - Webhook receiver for policy lifecycle (issued / amended / cancelled / claim_filed / resolved) into our trip-events ledger.
>
> **Volume signals:**
> - ~XX active travel agencies onboarded (TODO: replace with current number)
> - ~XX international flight bookings/month routed through our agent (TODO)
> - Average international trip value: ~$X,XXX (TODO)
> - Pricing model on our side: tenant agencies set their own agency markup on top of Faye's wholesale; Sendero takes a small protocol fee.
>
> **What we need to get started:**
> 1. Sandbox API key + access to your OpenAPI / docs.
> 2. Geographic coverage map (which origin / destination corridors Faye underwrites).
> 3. Standard partner contract terms — commission/wholesale pricing structure, data-protection / DPA, branding requirements.
> 4. Webhook signing scheme so we can verify inbound lifecycle events.
> 5. A 30-min call to walk through the integration model.
>
> Happy to send our security + DPA pack on request, and we can be in sandbox within 1-2 weeks of getting access.
>
> Thanks — looking forward to hearing back.
>
> Tomas
> Sendero | tomas@sendero.travel

---

## TODOs before sending

- [ ] Replace the three `(TODO:…)` placeholders with current numbers.
- [ ] Confirm the right inbox — `partnerships@withfaye.com` is the published one, but their landing page may have an updated form.
- [ ] If Faye has a web "Become a Partner" form, fill that AND email — both surfaces get logged.
- [ ] Attach: short capability deck (1 pager) — optional but signals seriousness. We have nothing today; ship without unless you want me to draft.
- [ ] Set a 5-business-day reminder. If no response, escalate via LinkedIn DM to a Faye partnerships hire (search "Faye Insurance" + "Partnerships" / "BD").

## Backup partners (queue these in parallel if Faye is slow)

| Partner | Inbox | Rationale |
|---|---|---|
| Battleface | `partnerships@battleface.com` | Modern programmatic; faster onboarding than legacy carriers |
| Cover Genius | `partner@covergenius.com` (or website form at covergenius.com/partner-with-us) | Built for embedding; multi-underwriter rate-shop = best end-customer pricing |
| SafetyWing | `affiliates@safetywing.com` | The most self-serve dev access; subscription model, fits long-stay nomads only |
