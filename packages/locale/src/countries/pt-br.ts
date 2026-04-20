import type { TravelGlossary } from '../types';

export const ptBR: TravelGlossary = {
  locale: 'pt-BR',
  country: 'BR',
  language: 'Portuguese',
  chatLanguage: 'pt-BR',
  currency: 'BRL',
  preferredCarriers: ['LA', 'G3', 'AD', 'O6'],
  travelTerms: {
    'ida e volta': 'roundtrip',
    'somente ida': 'one-way',
    escala: 'layover',
    conexão: 'connecting flight',
    econômica: 'economy class',
    executiva: 'business class',
    'primeira classe': 'first class',
    'bagagem despachada': 'checked bag',
    'bagagem de mão': 'carry-on',
    reembolso: 'refund',
    remarcação: 'rebooking / change',
    'Nota Fiscal': 'Brazilian tax invoice — required for corporate expense',
  },
  moneySlang: {
    grana: 'cash',
    pila: 'buck (regional)',
    mil: 'thousand',
  },
  commonPhrases: {
    'preciso de um voo': 'search_flights intent',
    'mais barato': 'sort by price ascending',
    'sem escalas': 'direct, no layover',
    'posso colocar na empresa?': 'check corporate policy',
    'posso cancelar?': 'check cancellation policy',
  },
  loyaltyPrograms: ['Smiles (G3)', 'LATAM Pass', 'TudoAzul (AD)'],
};
