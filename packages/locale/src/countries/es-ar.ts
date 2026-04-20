import type { TravelGlossary } from '../types';

export const esAR: TravelGlossary = {
  locale: 'es-AR',
  country: 'AR',
  language: 'Spanish',
  chatLanguage: 'es-AR',
  currency: 'ARS',
  preferredCarriers: ['AR', 'JA', 'LA'],
  travelTerms: {
    'ida y vuelta': 'roundtrip',
    'solo ida': 'one-way',
    escala: 'layover',
    'vuelo directo': 'direct',
    turista: 'economy class',
    ejecutiva: 'business class',
    valija: 'suitcase (checked)',
    'bolso de mano': 'carry-on',
    reintegro: 'refund',
    reprogramación: 'rebooking',
  },
  moneySlang: {
    guita: 'cash (slang)',
    mangos: 'pesos (informal)',
    palo: 'million (slang)',
  },
  commonPhrases: {
    'necesito volar': 'search_flights intent',
    'más barato': 'sort by price ascending',
    'sin escalas': 'direct, no layover',
    'puedo cambiarlo': 'check change policy',
    'factura A': 'request company tax invoice',
  },
  loyaltyPrograms: ['Aerolíneas Plus (AR)', 'LATAM Pass'],
};
