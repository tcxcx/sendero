import type { TravelGlossary } from '../types';

export const esMX: TravelGlossary = {
  locale: 'es-MX',
  country: 'MX',
  language: 'Spanish',
  chatLanguage: 'es-MX',
  currency: 'MXN',
  preferredCarriers: ['VB', 'Y4', 'AM', '4O'],
  travelTerms: {
    'vuelo redondo': 'roundtrip flight',
    'sólo ida': 'one-way flight',
    escala: 'layover',
    conexión: 'connecting flight',
    'clase turista': 'economy class',
    premier: 'Aeroméxico business class',
    'maleta documentada': 'checked bag',
    'maleta de mano': 'carry-on',
    'tarifa flexible': 'changeable fare',
    CFDI: 'facturación fiscal mexicana — required for expense reporting',
    RFC: 'tax ID for billing',
  },
  moneySlang: {
    lana: 'money (slang)',
    varo: 'cash (slang)',
    'luz verde': 'authorization granted',
  },
  commonPhrases: {
    'necesito un vuelo': 'search_flights intent',
    'más barato': 'sort by price ascending',
    'sin escalas': 'direct, no layover',
    'me lo puede expensar': 'check policy before booking',
    '¿puedo cancelar?': 'check cancellation policy',
  },
  loyaltyPrograms: ['Club Premier (AM)', 'VClub (VivaAerobus)'],
};
