import type { TravelGlossary } from '../types';

export const enUS: TravelGlossary = {
  locale: 'en-US',
  country: 'US',
  language: 'English',
  chatLanguage: 'en-US',
  currency: 'USD',
  preferredCarriers: ['DL', 'AA', 'UA', 'B6', 'WN', 'AS'],
  travelTerms: {
    'red-eye': 'overnight flight, typically 9pm-6am',
    layover: 'scheduled stop between segments (typically 1-4 hrs)',
    'basic economy': 'no changes, no seat selection, last to board',
    'premium economy': 'wider seat + better food, cheaper than business',
    TSA: 'Transportation Security Administration — airport security',
    'TSA PreCheck': 'expedited security for registered travelers',
    CLEAR: 'biometric fast-lane separate from TSA PreCheck',
  },
  moneySlang: {
    bucks: 'dollars',
    grand: 'thousand dollars',
  },
  commonPhrases: {
    'I need a flight': 'search_flights intent',
    cheapest: 'sort by price ascending',
    nonstop: 'direct, no layover',
    'can I expense this': 'check policy before booking',
  },
  loyaltyPrograms: ['SkyMiles (Delta)', 'AAdvantage (AA)', 'MileagePlus (UA)'],
};
