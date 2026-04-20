/**
 * Schema.org JSON-LD builders. Drop into a `<script type="application/ld+json">`
 * in a server component so Google surfaces rich results (sitelinks,
 * knowledge panel, FAQ accordion).
 */

export interface OrganizationJsonLd {
  '@context': 'https://schema.org';
  '@type': 'Organization';
  name: string;
  url: string;
  logo: string;
  sameAs?: string[];
  contactPoint?: {
    '@type': 'ContactPoint';
    contactType: string;
    email?: string;
    telephone?: string;
    areaServed?: string[];
    availableLanguage?: string[];
  };
}

export function organizationJsonLd(args: {
  siteUrl: string;
  logoUrl: string;
  sameAs?: string[];
  contactEmail?: string;
  supportedLanguages?: string[];
}): OrganizationJsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Sendero',
    url: args.siteUrl,
    logo: args.logoUrl,
    sameAs: args.sameAs,
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: args.contactEmail,
      availableLanguage: args.supportedLanguages ?? ['en', 'es', 'pt'],
    },
  };
}

export interface TravelAgencyJsonLd {
  '@context': 'https://schema.org';
  '@type': 'TravelAgency';
  name: string;
  url: string;
  description: string;
  priceRange: string;
  areaServed: string[];
  paymentAccepted: string[];
}

export function travelAgencyJsonLd(args: {
  siteUrl: string;
  description: string;
}): TravelAgencyJsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'TravelAgency',
    name: 'Sendero',
    url: args.siteUrl,
    description: args.description,
    priceRange: 'USDC nanopayments per action',
    areaServed: ['Worldwide'],
    paymentAccepted: ['USDC', 'Credit Card'],
  };
}

export interface SoftwareApplicationJsonLd {
  '@context': 'https://schema.org';
  '@type': 'SoftwareApplication';
  name: string;
  applicationCategory: 'TravelApplication';
  operatingSystem: string;
  offers: {
    '@type': 'Offer';
    priceCurrency: string;
    price: string;
    priceValidUntil?: string;
  };
  aggregateRating?: {
    '@type': 'AggregateRating';
    ratingValue: number;
    reviewCount: number;
  };
}

export function softwareApplicationJsonLd(args: {
  rating?: { value: number; count: number };
}): SoftwareApplicationJsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Sendero',
    applicationCategory: 'TravelApplication',
    operatingSystem: 'Web, WhatsApp, Slack, MCP',
    offers: {
      '@type': 'Offer',
      priceCurrency: 'USD',
      price: '0.02',
    },
    aggregateRating: args.rating
      ? {
          '@type': 'AggregateRating',
          ratingValue: args.rating.value,
          reviewCount: args.rating.count,
        }
      : undefined,
  };
}

export interface FaqJsonLd {
  '@context': 'https://schema.org';
  '@type': 'FAQPage';
  mainEntity: Array<{
    '@type': 'Question';
    name: string;
    acceptedAnswer: {
      '@type': 'Answer';
      text: string;
    };
  }>;
}

export function faqJsonLd(qa: Array<{ question: string; answer: string }>): FaqJsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: qa.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  };
}
