import { LegalPage } from '@/components/legal/legal-page';
import { createPageMetadata } from '@/lib/metadata';

export const metadata = createPageMetadata({
  title: 'Terms of Service · Sendero',
  description:
    'Terms governing your use of Sendero — the agentic travel-ops platform with on-chain USDC settlement. Covers acceptable use, API key handling, settlement liability, and termination.',
  path: '/terms',
  og: {
    title: 'Terms of Service',
    description: 'Your rights and responsibilities when using Sendero.',
  },
  keywords: ['sendero terms', 'travel agent terms', 'on-chain settlement terms', 'mcp terms'],
});

export default function TermsPage() {
  return (
    <LegalPage eyebrow="Legal" title="Terms of Service" effectiveDate="2026-04-28">
      <p>
        These terms govern your use of Sendero (the "Service"), operated by Sendero Travel Inc.
        ("we," "us"). By signing up for a workspace, minting an API key, or settling a booking
        through Sendero, you agree to these terms.
      </p>

      <h2>1. The service</h2>
      <p>
        Sendero is a B2B travel-ops platform. Agents (yours, ours, or third-party MCP clients)
        search travel inventory, place holds, ticket bookings, and settle on-chain in USDC. We
        provide the software and the rails; you (or your travelers) own the trips and the
        outcomes.
      </p>

      <h2>2. Eligibility &amp; accounts</h2>
      <ul>
        <li>You must be at least 18 and authorized to enter contracts on behalf of your organization.</li>
        <li>Workspace owners are responsible for the actions of all users they invite.</li>
        <li>API keys are credentials. Treat them like passwords — never check them into git.</li>
      </ul>

      <h2>3. Plan tiers &amp; billing</h2>
      <ul>
        <li>
          <strong>Free</strong> ($0/mo): $100 monthly cap, sandbox keys only. Practice the flow
          without moving real USDC.
        </li>
        <li>
          <strong>Basic</strong> ($19/mo, $15/mo annual): $2,000 cap, 3 production keys, 15% off
          nanopay rates, 5% off booking take-rate.
        </li>
        <li>
          <strong>Pro</strong> ($60/mo, $50/mo annual, 14-day trial without card): $20,000 cap,
          25 production keys, 30% off nanopay, 10% off take-rate. Unlimited workspaces.
        </li>
        <li>
          <strong>Enterprise</strong> (contact sales): custom cap + production-key allowance, 50%
          off nanopay, 15% off take-rate. SSO/SAML, audit log export, custom SLA.
        </li>
      </ul>

      <h3>3a. Per-call nanopayments</h3>
      <p>
        On top of the monthly subscription, every metered tool call charges a small amount of
        USDC from your workspace's Arc wallet. Discounts compound: a Pro tenant pays 70% of base
        nanopay rate per call, and the discount is materialized into{' '}
        <code>MeterEvent.priceMicroUsdc</code> at dispatch time.
      </p>

      <h3>3b. Take-rate on settled bookings</h3>
      <p>
        We charge a take-rate (default 50bps, lower with higher plans) on every booking your
        agent confirms. This is added on top of the carrier/supplier fare. Itemized on the
        invoice.
      </p>

      <h3>3c. Refunds</h3>
      <p>
        Subscription fees: pro-rated refund within 14 days of a charge if you've made fewer than
        10 production-key calls. Nanopayments are non-refundable once a tool call has executed.
        Booking refunds follow the underlying carrier's policy; we don't refund take-rate on a
        cancelled booking but we don't add new take-rate on the refund either.
      </p>

      <h2>4. Acceptable use</h2>
      <p>You may not, and may not allow your agent to:</p>
      <ul>
        <li>Book travel for sanctioned individuals or destinations.</li>
        <li>Use Sendero to launder money or obscure beneficial ownership.</li>
        <li>Mint API keys faster than your plan tier allows or share keys across workspaces.</li>
        <li>Reverse-engineer the platform, scrape inventory, or DDoS the API.</li>
        <li>Resell Sendero capacity to a third party without an explicit reseller agreement.</li>
      </ul>

      <h2>5. On-chain settlement</h2>
      <ul>
        <li>
          Sendero uses Circle's USDC + Arc rails. Confirmed bookings write an on-chain row that
          surfaces an Arcscan URL in the response payload.
        </li>
        <li>
          On-chain transactions are <strong>final</strong>. We can't reverse a settled
          transaction; refunds are forward transactions back to your wallet.
        </li>
        <li>
          During the testnet beta, Arc-Testnet USDC is used. No real value moves. We'll flip the
          flag when Circle promotes Arc mainnet.
        </li>
      </ul>

      <h2>6. Liability</h2>
      <ul>
        <li>
          Sendero is software; the trip is between you and the carrier/hotel/supplier. We act as
          an intermediary, not a fiduciary.
        </li>
        <li>
          We do <strong>not</strong> indemnify you for missed flights, cancelled hotels, or
          third-party supplier failures. Carrier policy controls.
        </li>
        <li>
          Our aggregate liability for any twelve-month period is capped at the greater of (a) the
          fees you paid Sendero in that period, or (b) $1,000.
        </li>
        <li>
          We are not liable for indirect, consequential, special, incidental, or punitive
          damages — including lost profits, lost trips, or lost goodwill.
        </li>
      </ul>

      <h2>7. Indemnity</h2>
      <p>
        You agree to indemnify Sendero against third-party claims arising from your use of the
        Service in violation of these terms — for example, a claim that your agent booked
        unauthorized travel for someone who didn't consent.
      </p>

      <h2>8. Termination</h2>
      <ul>
        <li>You may close your workspace at any time from the dashboard.</li>
        <li>
          We may suspend a workspace for unpaid invoices, abuse, or regulatory holds — with
          notice when reasonable.
        </li>
        <li>
          On termination: API keys are revoked, holds are released within 24 hours, and your data
          is deleted per our{' '}
          <a href="/policy">Privacy Policy</a>'s retention schedule.
        </li>
      </ul>

      <h2>9. Changes to these terms</h2>
      <p>
        We update these terms when the platform or law changes. Material changes are emailed to
        workspace owners 14 days before the new version takes effect. Continued use after that
        date constitutes acceptance.
      </p>

      <h2>10. Governing law</h2>
      <p>
        These terms are governed by the laws of the State of Delaware, USA, without regard to
        conflict-of-law rules. Disputes resolve in the state and federal courts located in
        Wilmington, Delaware. Workspace owners outside the US may be entitled to mandatory
        consumer-protection rules in their jurisdiction; nothing here waives those.
      </p>

      <h2>11. Contact</h2>
      <p>
        General: <a href="mailto:legal@sendero.travel">legal@sendero.travel</a>
        <br />
        Disputes: <a href="mailto:legal@sendero.travel">legal@sendero.travel</a> with subject
        line "DISPUTE — &lt;workspace name&gt;"
      </p>
    </LegalPage>
  );
}
