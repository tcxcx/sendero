import { LegalPage } from '@/components/legal/legal-page';
import { createPageMetadata } from '@/lib/metadata';

export const metadata = createPageMetadata({
  title: 'Privacy Policy · Sendero',
  description:
    'How Sendero, operated by Stampa SpA, collects, uses, and protects travel support and trip operations data.',
  path: '/policy',
  og: {
    title: 'Privacy Policy',
    description: 'How Sendero protects your data.',
  },
  keywords: ['sendero privacy policy', 'travel data privacy', 'agent telemetry privacy', 'GDPR'],
});

export default function PolicyPage() {
  return (
    <LegalPage eyebrow="Legal" title="Privacy Policy" effectiveDate="2026-04-28">
      <p>
        This policy describes what Sendero collects, why, and how we keep it safe. Sendero is a
        travel support and trip operations product operated by Stampa SpA. Travelers, agencies, and
        companies use Sendero to plan trips, coordinate support, manage bookings, and receive help
        across WhatsApp, Slack, and the web console.
      </p>

      <h2>1. What we collect</h2>
      <h3>1a. Account &amp; workspace data</h3>
      <ul>
        <li>
          Email, name, organization name, and role — from <strong>Clerk</strong>, our authentication
          provider. We don't store your password; Clerk does.
        </li>
        <li>
          API keys you mint via Clerk's <code>&lt;APIKeys /&gt;</code> component. We hold the token
          hash, not the raw key.
        </li>
        <li>
          Plan tier (Free / Basic / Pro / Enterprise) and billing identity from Clerk Billing.
        </li>
      </ul>

      <h3>1b. Trip &amp; agent data</h3>
      <ul>
        <li>
          Travel records (legs, travelers, holds, bookings, settlements) created when your agent
          calls Sendero tools. Stored in our Postgres database hosted on <strong>Neon</strong>,
          region <code>aws-us-east-1</code>.
        </li>
        <li>
          Agent transcripts and tool-call logs (input/output of every metered call). Used to serve
          replays, debugging, and Langfuse-based quality tracking.
        </li>
      </ul>

      <h3>1c. Payment data</h3>
      <ul>
        <li>
          On-chain wallet addresses and USDC settlement records from <strong>Circle</strong>{' '}
          (Arc-Testnet today; Arc-Mainnet at GA). Wallet addresses are public on-chain by design.
        </li>
        <li>
          Card-and-fiat data (subscriptions) is handled entirely by{' '}
          <strong>Stripe via Clerk Billing</strong>. We never see card numbers.
        </li>
      </ul>

      <h3>1d. Telemetry</h3>
      <ul>
        <li>Web traffic logs, server response times, error stack traces.</li>
        <li>Langfuse traces for agent turns (system prompt → tool calls → response).</li>
        <li>Vercel Analytics for the marketing + app surfaces.</li>
      </ul>

      <h2>2. Why we collect it</h2>
      <ul>
        <li>
          <strong>Run the service.</strong> We can't book a flight without knowing the route.
        </li>
        <li>
          <strong>Bill correctly.</strong> Plan tier + per-call meter events drive your invoice.
        </li>
        <li>
          <strong>Audit.</strong> Every settlement writes an on-chain row + a meter event. Auditors
          and finance teams need the trail.
        </li>
        <li>
          <strong>Improve quality.</strong> Langfuse traces let us catch regressions in agent
          behavior (tool-call success rate, latency).
        </li>
        <li>
          <strong>Comply.</strong> Anti-fraud, anti-money-laundering, regulatory holds.
        </li>
      </ul>

      <h2>3. Sub-processors</h2>
      <p>
        Sendero uses the following sub-processors. Each receives only the data they need to perform
        their function. Your access to your own data is not throttled by them.
      </p>
      <ul>
        <li>
          <strong>Clerk</strong> — auth + billing UI
        </li>
        <li>
          <strong>Stripe</strong> — payment processing (via Clerk)
        </li>
        <li>
          <strong>Circle</strong> — USDC custody + Arc settlement
        </li>
        <li>
          <strong>Duffel</strong> — flight search + booking
        </li>
        <li>
          <strong>Neon (Postgres)</strong> — primary database
        </li>
        <li>
          <strong>Upstash</strong> — Redis cache + rate-limit state
        </li>
        <li>
          <strong>Langfuse</strong> — agent observability
        </li>
        <li>
          <strong>Vercel</strong> — hosting (apps/app, apps/docs, apps/marketing)
        </li>
        <li>
          <strong>Cloudflare</strong> — edge proxy (apps/edge)
        </li>
        <li>
          <strong>Resend</strong> — transactional email
        </li>
      </ul>

      <h2>4. Your rights</h2>
      <p>You can:</p>
      <ul>
        <li>
          <strong>Access</strong> your data — every workspace surface in the dashboard exposes it.
        </li>
        <li>
          <strong>Export</strong> trip and settlement data via <code>export_audit_log</code>,{' '}
          <code>export_trip_summary</code>, and the OpenAPI surface.
        </li>
        <li>
          <strong>Correct</strong> data — open a ticket via the dashboard or email below.
        </li>
        <li>
          <strong>Delete</strong> your workspace — email{' '}
          <a href="mailto:privacy@sendero.travel">privacy@sendero.travel</a>. We honor deletion
          within 30 days, except where retention is required by law (financial records: 7 years).
        </li>
        <li>
          <strong>Withdraw consent</strong> for telemetry — set <code>SENDERO_TELEMETRY=off</code>{' '}
          in your CLI env. Server-side telemetry is load-bearing for the service and can't be opted
          out individually; deleting the workspace is the path.
        </li>
      </ul>

      <h2>5. Data retention</h2>
      <ul>
        <li>Active trip + booking data: retained while the workspace is active.</li>
        <li>Settlement + on-chain audit data: 7 years (regulatory).</li>
        <li>Telemetry: 90 days rolling.</li>
        <li>Langfuse traces: 30 days rolling.</li>
        <li>Deleted workspace: backups purge within 30 days.</li>
      </ul>

      <h2>6. Security</h2>
      <ul>
        <li>TLS in transit, encryption at rest (Neon + Upstash + Vercel Blob).</li>
        <li>API keys hashed at rest; we cannot recover a lost raw key.</li>
        <li>Webhook signatures verified (Circle, Clerk, Slack, WhatsApp, Stripe).</li>
        <li>Rate limits + bot detection on every public surface.</li>
        <li>Annual penetration testing + ongoing dependency scanning.</li>
      </ul>

      <h2>7. Children</h2>
      <p>
        Sendero is a B2B platform. We do not knowingly collect data from anyone under 18. If you
        believe a child has provided us with data, contact{' '}
        <a href="mailto:privacy@sendero.travel">privacy@sendero.travel</a>.
      </p>

      <h2>8. International transfers</h2>
      <p>
        Sendero hosts data primarily in the US (Vercel, Neon). EU-origin data is transferred under
        Standard Contractual Clauses with our sub-processors. Argentina-, Mexico-, and Brazil-
        origin traffic is served from the closest available Vercel edge.
      </p>

      <h2>9. Changes to this policy</h2>
      <p>
        We update this page when sub-processors or practices change. The effective date at the top
        always reflects the active version. Material changes are emailed to workspace owners 14 days
        before they take effect.
      </p>

      <h2>10. Contact</h2>
      <p>
        Privacy: <a href="mailto:privacy@sendero.travel">privacy@sendero.travel</a>
        <br />
        Security disclosures: <a href="mailto:security@sendero.travel">security@sendero.travel</a>
        <br />
        General legal: <a href="mailto:legal@sendero.travel">legal@sendero.travel</a>
      </p>
    </LegalPage>
  );
}
