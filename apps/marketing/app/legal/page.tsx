import { LegalPage } from '@/components/legal/legal-page';
import { createPageMetadata } from '@/lib/metadata';

export const metadata = createPageMetadata({
  title: 'Legal Operator & Support · Sendero',
  description:
    'Legal operator, customer support, privacy, terms, and travel support policies for Sendero, operated by Stampa SpA.',
  path: '/legal',
  og: {
    title: 'Legal Operator & Support',
    description: 'Sendero travel support and trip operations are operated by Stampa SpA.',
  },
  keywords: [
    'Sendero legal operator',
    'Stampa SpA',
    'Sendero support',
    'travel support policy',
    'WhatsApp business profile',
  ],
});

export default function LegalOperatorPage() {
  return (
    <LegalPage eyebrow="Legal" title="Legal Operator & Support" effectiveDate="2026-05-01">
      <p>
        Sendero is a travel support and trip operations product operated by{' '}
        <strong>Stampa SpA</strong>. This page provides the public business profile, support
        contacts, and policy links used for customer support channels, including WhatsApp.
      </p>

      <h2>Business identity</h2>
      <ul>
        <li>
          <strong>Legal operator:</strong> Stampa SpA
        </li>
        <li>
          <strong>Operating product:</strong> Sendero
        </li>
        <li>
          <strong>Business category:</strong> Travel support, trip operations, booking assistance,
          itinerary coordination, and customer support
        </li>
        <li>
          <strong>Website:</strong>{' '}
          <a href="https://sendero.travel/legal">https://sendero.travel/legal</a>
        </li>
      </ul>

      <h2>Customer support</h2>
      <p>
        Sendero helps travelers, agencies, and companies coordinate trip requests, booking support,
        itinerary questions, change requests, cancellation guidance, and post-booking assistance.
      </p>
      <ul>
        <li>
          <strong>General support:</strong>{' '}
          <a href="mailto:support@sendero.travel">support@sendero.travel</a>
        </li>
        <li>
          <strong>Sales:</strong> <a href="mailto:sales@sendero.travel">sales@sendero.travel</a>
        </li>
        <li>
          <strong>Legal:</strong> <a href="mailto:legal@sendero.travel">legal@sendero.travel</a>
        </li>
        <li>
          <strong>Privacy:</strong>{' '}
          <a href="mailto:privacy@sendero.travel">privacy@sendero.travel</a>
        </li>
      </ul>

      <h2>WhatsApp support profile</h2>
      <p>
        The Sendero WhatsApp support channel is used for customer service and travel operations
        support. Messages may be handled by authorized support staff and approved support automation
        so customers can receive help with trip intake, booking questions, account access, itinerary
        changes, support forms, and escalation to the Sendero team.
      </p>
      <ul>
        <li>
          <strong>Recommended WhatsApp display name:</strong> Sendero by Stampa SpA
        </li>
        <li>
          <strong>Business profile description:</strong> Travel support and trip operations for
          Sendero, operated by Stampa SpA.
        </li>
        <li>
          <strong>Support number:</strong> +1 201-471-6461
        </li>
      </ul>

      <h2>Travel support policy</h2>
      <p>
        Sendero assists with travel planning, booking coordination, customer support, and trip
        follow-up. Final pricing, availability, schedule changes, cancellations, refunds, and
        service conditions are controlled by the relevant airline, hotel, transfer provider,
        restaurant, or travel supplier. Sendero helps communicate those conditions and route support
        requests to the appropriate operator or supplier.
      </p>

      <h2>Refunds, changes, and cancellations</h2>
      <p>
        Refunds, changes, and cancellations depend on the policy attached to the confirmed booking
        or supplier service. Customers should contact support with the booking reference, traveler
        name, and requested change. Sendero will review the request, explain available options, and
        coordinate next steps where a supplier allows a change, cancellation, or refund.
      </p>

      <h2>Privacy and terms</h2>
      <p>
        Sendero uses customer data to provide travel support, operate accounts, respond to support
        requests, coordinate trip workflows, and maintain service security. Read the current policy
        documents here:
      </p>
      <ul>
        <li>
          <a href="/policy">Privacy Policy</a>
        </li>
        <li>
          <a href="/terms">Terms of Service</a>
        </li>
      </ul>

      <h2>Review note</h2>
      <p>
        For account or platform reviews: Stampa SpA is the legal business operator. Sendero is the
        travel support and trip operations product operated by Stampa SpA. The WhatsApp support
        channel is intended for travel customer support, trip intake, booking assistance, account
        help, and escalation to the Sendero support team.
      </p>
    </LegalPage>
  );
}
