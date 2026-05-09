/**
 * B6 — Lifestyle / Local Commerce (12 tools).
 *
 *   - shopping_district_brief        B6 #87
 *   - local_designer_finder          B6 #88
 *   - market_day_finder              B6 #89
 *   - gift_recommender               B6 #90
 *   - pharmacy_product_mapper        B6 #91
 *   - electronics_adapter_checker    B6 #92
 *   - luggage_repair_finder          B6 #93
 *   - laundry_service_finder         B6 #94
 *   - tailor_urgent_finder           B6 #95
 *   - personal_shopper_light         B6 #96
 *   - vintage_thrift_finder          B6 #97
 *   - craft_beer_finder              B6 #98
 *
 * Mostly Places + CSE finders (8). 4 pure tools: gift_recommender,
 * pharmacy_product_mapper, electronics_adapter_checker, market_day_finder.
 *
 * All experimental + internal + dev-gated.
 */

import { z } from 'zod';

import { searchText } from '@sendero/google-places';
import { cseSearch } from '@sendero/web-search';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

import {
  liveFinderDeps,
  runGroundedFinder,
  type GroundedFinderConfig,
  type GroundedShopHit,
} from './_grounded-place-finder';

const baseInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  languageCode: z.string().max(10).default('en'),
  limit: z.number().int().min(1).max(15).default(8),
});
type BaseInput = z.infer<typeof baseInput>;

type FinderResult =
  | { status: 'ok'; city: string; shops: GroundedShopHit[]; message: string }
  | { status: 'production_refused'; message: string }
  | { status: 'unavailable'; reason: string; message: string };

async function runCfgFinder(
  cfg: GroundedFinderConfig,
  input: BaseInput,
  ctx?: ToolContext
): Promise<FinderResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };
  const r = await runGroundedFinder(
    cfg,
    {
      city: input.city,
      ...(input.countryCode ? { countryCode: input.countryCode } : {}),
      languageCode: input.languageCode,
      limit: input.limit,
    },
    liveFinderDeps
  );
  if (r.status === 'unavailable') return r;
  return { status: 'ok', city: r.city, shops: r.shops, message: r.message };
}

const baseJsonProps = {
  city: { type: 'string', minLength: 1, maxLength: 120 },
  countryCode: { type: 'string', minLength: 2, maxLength: 2 },
  languageCode: { type: 'string', maxLength: 10 },
  limit: { type: 'integer', minimum: 1, maximum: 15 },
} as const;

// ── 1. shopping_district_brief (CSE-led) ─────────────────────────────

const SHOPPING_WEIGHTS: Record<string, number> = {
  'monocle.com': 0.95,
  'wallpaper.com': 0.9,
  'cntraveler.com': 0.7,
  'cntraveler.com/destinations': 0.7,
  'theguardian.com': 0.55,
  'businessoffashion.com': 0.85,
  'highsnobiety.com': 0.75,
  'ssense.com': 0.7,
  'apartamento-magazine.com': 0.8,
  'lonelyplanet.com': 0.55,
  'timeout.com': 0.5,
};

const SHOPPING_TYPES = new Set([
  'shopping_mall',
  'department_store',
  'clothing_store',
  'shoe_store',
  'jewelry_store',
  'home_goods_store',
  'point_of_interest',
  'tourist_attraction',
]);

const shoppingDistrictBriefTool: ToolDef<BaseInput, FinderResult> = {
  name: 'shopping_district_brief',
  internal: true,
  description:
    "Find shopping districts / streets / neighborhoods in a city — e.g. 'Marais Paris', 'Aoyama Tokyo', 'Palermo Soho'. CSE editorial via Monocle / Wallpaper / Business of Fashion + Places. Use when traveler asks 'best shopping in <city>', 'compras <ciudad>'.",
  inputSchema: baseInput,
  jsonSchema: { type: 'object', required: ['city'], properties: { ...baseJsonProps } },
  handler: (input, ctx) =>
    runCfgFinder(
      {
        composeCseQuery: city =>
          input.languageCode === 'es'
            ? `mejores barrios de compras ${city}`
            : `best shopping neighborhoods districts ${city}`,
        composePlacesQuery: city => `shopping district ${city}`,
        sourceWeights: SHOPPING_WEIGHTS,
        defaultSourceWeight: 0.25,
        isRelevantPlaceType: place => {
          const all = [...(place.types ?? []), place.primaryType].filter(Boolean) as string[];
          return all.some(t => SHOPPING_TYPES.has(t));
        },
        cseSnippetMustMatch: /\b(shopping|district|neighborhood|barrio|fashion|boutique)\b/i,
      },
      input,
      ctx
    ),
};

// ── 2. local_designer_finder ─────────────────────────────────────────

const DESIGNER_WEIGHTS: Record<string, number> = {
  'monocle.com': 0.95,
  'wallpaper.com': 0.9,
  'dezeen.com': 0.85,
  'designboom.com': 0.8,
  'businessoffashion.com': 0.85,
  'highsnobiety.com': 0.75,
  'apartamento-magazine.com': 0.85,
  'kinfolk.com': 0.75,
  'cntraveler.com': 0.55,
  'theguardian.com': 0.5,
};

const DESIGNER_TYPES = new Set([
  'clothing_store',
  'shoe_store',
  'home_goods_store',
  'store',
  'jewelry_store',
]);

const localDesignerFinderTool: ToolDef<BaseInput, FinderResult> = {
  name: 'local_designer_finder',
  internal: true,
  description:
    'Find local designer / boutique / concept stores. Editorial via Monocle / Wallpaper / Dezeen / Business of Fashion + Places. Use when traveler asks "boutiques <city>", "concept store", "diseño independiente <ciudad>".',
  inputSchema: baseInput,
  jsonSchema: { type: 'object', required: ['city'], properties: { ...baseJsonProps } },
  handler: (input, ctx) =>
    runCfgFinder(
      {
        composeCseQuery: city =>
          input.languageCode === 'es'
            ? `tiendas concepto diseño local ${city}`
            : `concept stores independent designers ${city}`,
        composePlacesQuery: city => `concept store designer ${city}`,
        sourceWeights: DESIGNER_WEIGHTS,
        defaultSourceWeight: 0.25,
        isRelevantPlaceType: place => {
          const all = [...(place.types ?? []), place.primaryType].filter(Boolean) as string[];
          return all.some(t => DESIGNER_TYPES.has(t));
        },
        cseSnippetMustMatch: /\b(concept store|boutique|designer|design-led|tienda|atelier)\b/i,
      },
      input,
      ctx
    ),
};

// ── 3. market_day_finder (pure curated + CSE fallback) ───────────────

const marketDayInput = baseInput.extend({
  marketKind: z
    .enum(['flea', 'farmers', 'antique', 'craft', 'design', 'general'])
    .default('general'),
});
type MarketDayInput = z.infer<typeof marketDayInput>;

interface MarketEntry {
  name: string;
  city: string;
  days: string;
  notes?: string;
  url?: string;
}

const CURATED_MARKETS: Array<MarketEntry & { kind: MarketDayInput['marketKind'] }> = [
  {
    name: 'Marché aux Puces de Saint-Ouen',
    city: 'paris',
    days: 'Sat-Sun-Mon mornings',
    kind: 'flea',
    notes: 'Largest flea market in Europe.',
  },
  {
    name: 'Portobello Road Market',
    city: 'london',
    days: 'Saturday',
    kind: 'antique',
    notes: 'Antiques + vintage.',
  },
  {
    name: 'Borough Market',
    city: 'london',
    days: 'Tue-Sat',
    kind: 'farmers',
    notes: 'Food market, Tue-Sat 10:00-17:00.',
  },
  {
    name: 'Mercato di Porta Portese',
    city: 'rome',
    days: 'Sunday',
    kind: 'flea',
    notes: 'Massive Sunday-only flea market.',
  },
  {
    name: 'San Telmo Sunday Fair',
    city: 'buenos aires',
    days: 'Sunday',
    kind: 'antique',
    notes: 'Antiques + crafts on Defensa street.',
  },
  {
    name: 'Mercado de Coyoacán',
    city: 'mexico city',
    days: 'daily; Sat-Sun busiest',
    kind: 'craft',
    notes: 'Craft + food.',
  },
  { name: "Hell's Kitchen Flea Market", city: 'new york', days: 'Sat-Sun', kind: 'flea' },
  { name: 'Chelsea Flea', city: 'new york', days: 'Sat-Sun', kind: 'flea' },
  { name: 'Brooklyn Flea', city: 'new york', days: 'weekend rotating', kind: 'flea' },
  { name: 'Marché Bastille', city: 'paris', days: 'Thu + Sun mornings', kind: 'farmers' },
  {
    name: 'Mauerpark Flohmarkt',
    city: 'berlin',
    days: 'Sunday',
    kind: 'flea',
    notes: 'Iconic Sunday flea + open-air karaoke.',
  },
  { name: 'Boqueria', city: 'barcelona', days: 'Mon-Sat', kind: 'farmers' },
  {
    name: 'Tsukiji Outer Market',
    city: 'tokyo',
    days: 'daily; mornings best',
    kind: 'farmers',
    notes: 'Inner wholesale market relocated; outer market lives on.',
  },
  { name: 'Camden Market', city: 'london', days: 'daily', kind: 'craft' },
  {
    name: 'Chatuchak Weekend Market',
    city: 'bangkok',
    days: 'Sat-Sun',
    kind: 'general',
    notes: '8000+ stalls.',
  },
];

async function runMarketDayFinder(
  rawInput: MarketDayInput,
  ctx?: ToolContext
): Promise<{
  status: 'ok' | 'production_refused' | 'unavailable';
  message: string;
  markets?: MarketEntry[];
}> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = marketDayInput.parse(rawInput);
  const cityKey = input.city.trim().toLowerCase();

  const curated = CURATED_MARKETS.filter(
    m => m.city === cityKey && (input.marketKind === 'general' || m.kind === input.marketKind)
  );
  if (curated.length > 0) {
    return {
      status: 'ok',
      markets: curated.slice(0, input.limit).map(c => ({
        name: c.name,
        city: c.city,
        days: c.days,
        ...(c.notes ? { notes: c.notes } : {}),
      })),
      message: `${curated.length} curated ${input.marketKind} markets in ${input.city}.`,
    };
  }

  // CSE fallback for cities not in the curated list.
  const cseR = await cseSearch({
    query: `${input.marketKind} market ${input.city} schedule days`,
    limit: input.limit,
    lang: input.languageCode,
    ...(input.countryCode ? { country: input.countryCode } : {}),
  });
  if (!cseR.available) {
    return { status: 'unavailable', message: `CSE unavailable: ${cseR.reason ?? 'unknown'}.` };
  }
  return {
    status: 'ok',
    markets: cseR.results.slice(0, input.limit).map(hit => ({
      name: hit.title.trim(),
      city: input.city,
      days: 'check listing',
      ...(hit.snippet ? { notes: hit.snippet } : {}),
      url: hit.link,
    })),
    message: `${cseR.results.length} market candidates for ${input.city} via CSE.`,
  };
}

const marketDayFinderTool: ToolDef = {
  name: 'market_day_finder',
  internal: true,
  description:
    'Find market days in a city — flea / farmers / antique / craft / design. Curated table for top 15 cities; CSE fallback for everywhere else. Use when traveler asks "what market is happening this weekend in <city>".',
  inputSchema: marketDayInput,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      ...baseJsonProps,
      marketKind: {
        type: 'string',
        enum: ['flea', 'farmers', 'antique', 'craft', 'design', 'general'],
      },
    },
  },
  handler: runMarketDayFinder,
};

// ── 4. gift_recommender (pure rules) ─────────────────────────────────

const giftInput = z.object({
  countryCode: z.string().length(2),
  budgetUsd: z.number().nonnegative().max(2000).default(40),
  recipient: z
    .enum(['client', 'partner', 'family', 'friend', 'host_family', 'colleague', 'self'])
    .default('friend'),
  travelerNationalityCode: z.string().length(2).optional(),
});
type GiftInput = z.infer<typeof giftInput>;

interface GiftSuggestion {
  category: string;
  examples: string[];
  approximateBudget: string;
  packingNote?: string;
}

const COUNTRY_GIFT_SUGGESTIONS: Record<
  string,
  Array<{ category: string; examples: string[]; budgetTier: 'low' | 'medium' | 'high' }>
> = {
  JP: [
    {
      category: 'food',
      examples: [
        'Yokan / wagashi from a temple shop',
        'Tea (gyokuro / hojicha) from Ippodo or Marukyu Koyamaen',
        'Single-origin Tokyo coffee beans',
      ],
      budgetTier: 'medium',
    },
    {
      category: 'craft',
      examples: [
        'Tenugui hand towel from Kamawanu',
        'Ceramic teacup from Ginza Sayegusa',
        'Furoshiki cloth',
      ],
      budgetTier: 'medium',
    },
  ],
  FR: [
    {
      category: 'food',
      examples: [
        'Comté or Beaufort cheese (vacuum-packed at the airport)',
        'Bonne Maman jams',
        'Pierre Hermé chocolates',
      ],
      budgetTier: 'medium',
    },
    {
      category: 'craft',
      examples: [
        'Astier de Villatte ceramic',
        'Le Labo travel candle',
        'Diptyque candle (smaller pour-over jar)',
      ],
      budgetTier: 'high',
    },
  ],
  IT: [
    {
      category: 'food',
      examples: [
        'Aged balsamic from Modena',
        "Saffron from L'Aquila",
        'Real DOP Parmigiano (vacuum-pack)',
      ],
      budgetTier: 'medium',
    },
    {
      category: 'craft',
      examples: [
        'Florentine leather small good (cardholder, notebook cover)',
        'Murano glass paperweight',
      ],
      budgetTier: 'medium',
    },
  ],
  AR: [
    {
      category: 'food',
      examples: [
        'Yerba mate (Cruz de Malta or Rosamonte) + bombilla',
        'Alfajores Havanna',
        'Olive oil from Mendoza',
      ],
      budgetTier: 'low',
    },
    {
      category: 'craft',
      examples: [
        'Leather mate cup',
        'Argentine wool throw',
        'Facón (decorative knife — pack in checked!)',
      ],
      budgetTier: 'medium',
    },
  ],
  MX: [
    {
      category: 'food',
      examples: ['Mole paste from Oaxaca', 'Mexican vanilla', 'Tequila aged 1+ years'],
      budgetTier: 'medium',
    },
    {
      category: 'craft',
      examples: ['Talavera pottery', 'Oaxaca rug', 'Alebrije'],
      budgetTier: 'medium',
    },
  ],
  GB: [
    {
      category: 'food',
      examples: [
        'Single-estate tea (Postcard Teas)',
        'Marmite jar gift set',
        'Fortnum & Mason biscuits',
      ],
      budgetTier: 'medium',
    },
    {
      category: 'craft',
      examples: ['Liberty London printed scarf', 'Burberry scarf travel size', 'Wedgwood mug'],
      budgetTier: 'high',
    },
  ],
};

async function runGiftRecommender(
  rawInput: GiftInput,
  ctx?: ToolContext
): Promise<{
  status: 'ok' | 'production_refused';
  message: string;
  suggestions?: GiftSuggestion[];
}> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = giftInput.parse(rawInput);
  const cc = input.countryCode.toUpperCase();
  const tableEntries = COUNTRY_GIFT_SUGGESTIONS[cc];
  const tier = input.budgetUsd < 25 ? 'low' : input.budgetUsd < 80 ? 'medium' : 'high';
  const recipientGuard =
    input.recipient === 'client'
      ? 'Stay neutral — no alcohol unless you know preferences. Sealed packaging matters.'
      : input.recipient === 'host_family'
        ? 'Bring something edible from your home country + something from this trip. Two small > one big.'
        : '';

  const suggestions: GiftSuggestion[] = tableEntries
    ? tableEntries
        .filter(e => e.budgetTier === tier || e.budgetTier === (tier === 'high' ? 'medium' : tier))
        .slice(0, 4)
        .map(e => ({
          category: e.category,
          examples: e.examples,
          approximateBudget: tier === 'low' ? '$15-30' : tier === 'medium' ? '$30-80' : '$80-200+',
          packingNote:
            e.category === 'craft' && /knife|wool/i.test(e.examples.join(' '))
              ? 'Check airline rules; some items go in checked baggage only.'
              : 'Buy at the airport when possible — duty-free + last-minute packing risk lower.',
        }))
    : [
        {
          category: 'general',
          examples: [
            `Local food specialty from ${input.countryCode}`,
            `Local craft (textile / ceramic / leather)`,
            `Regional spirits or coffee`,
          ],
          approximateBudget: tier === 'low' ? '$15-30' : tier === 'medium' ? '$30-80' : '$80-200+',
          packingNote:
            'No curated list for this country yet — head to the airport gift shop with the highest editorial signal.',
        },
      ];

  if (recipientGuard)
    suggestions[0]!.packingNote = `${recipientGuard} ${suggestions[0]!.packingNote ?? ''}`.trim();

  return {
    status: 'ok',
    suggestions,
    message: `${suggestions.length} gift category suggestions for ${cc} / ${input.recipient} / $${input.budgetUsd}.`,
  };
}

const giftRecommenderTool: ToolDef = {
  name: 'gift_recommender',
  internal: true,
  description:
    'Suggest local gifts to bring back from a country, by budget tier + recipient (client / partner / family / friend / host_family / colleague / self). Pure curated tables for ~10 most-traveled countries; generic suggestions for the rest. Use when traveler asks "what should I bring back from <country>".',
  inputSchema: giftInput,
  jsonSchema: {
    type: 'object',
    required: ['countryCode'],
    properties: {
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      budgetUsd: { type: 'number', minimum: 0, maximum: 2000 },
      recipient: {
        type: 'string',
        enum: ['client', 'partner', 'family', 'friend', 'host_family', 'colleague', 'self'],
      },
      travelerNationalityCode: { type: 'string', minLength: 2, maxLength: 2 },
    },
  },
  handler: runGiftRecommender,
};

// ── 5. pharmacy_product_mapper (pure curated) ────────────────────────

const pharmacyInput = z.object({
  countryCode: z.string().length(2),
  /** Common name in caller's language / English. */
  productName: z.string().min(1).max(120),
  /** Caller's locale — drives translation direction. */
  fromLocale: z.string().min(2).max(10).default('en-US'),
});
type PharmacyInput = z.infer<typeof pharmacyInput>;

const PHARMACY_MAP: Record<
  string,
  Record<string, { localName: string; brand?: string; otc: boolean; notes?: string }>
> = {
  ES: {
    ibuprofen: { localName: 'ibuprofeno', brand: 'Espidifen', otc: true },
    acetaminophen: { localName: 'paracetamol', brand: 'Gelocatil', otc: true },
    paracetamol: { localName: 'paracetamol', brand: 'Gelocatil', otc: true },
    antihistamine: { localName: 'antihistamínico', brand: 'Cetirizina genérico', otc: true },
    sunscreen: { localName: 'protector solar', otc: true },
  },
  AR: {
    ibuprofen: { localName: 'ibuprofeno', brand: 'Ibupirac', otc: true },
    acetaminophen: { localName: 'paracetamol', brand: 'Tafirol', otc: true },
    paracetamol: { localName: 'paracetamol', brand: 'Tafirol', otc: true },
    antihistamine: { localName: 'antihistamínico', brand: 'Loratadina genérica', otc: true },
    sunscreen: { localName: 'protector solar', otc: true },
  },
  MX: {
    ibuprofen: { localName: 'ibuprofeno', brand: 'Advil', otc: true },
    acetaminophen: { localName: 'paracetamol', brand: 'Tempra', otc: true },
    paracetamol: { localName: 'paracetamol', brand: 'Tempra', otc: true },
  },
  JP: {
    ibuprofen: {
      localName: 'イブプロフェン',
      brand: 'Eve',
      otc: true,
      notes: 'Eve A is most common; brand-name OTC.',
    },
    acetaminophen: { localName: 'アセトアミノフェン', brand: 'Tylenol', otc: true },
    antihistamine: { localName: '抗ヒスタミン', brand: 'Claritin', otc: true },
    sunscreen: {
      localName: '日焼け止め',
      otc: true,
      notes: 'Anessa Perfect UV is the cult choice.',
    },
  },
  FR: {
    ibuprofen: {
      localName: 'ibuprofène',
      brand: 'Advil / Nurofen',
      otc: true,
      notes: 'Pharmacy-only (no supermarket).',
    },
    acetaminophen: {
      localName: 'paracétamol',
      brand: 'Doliprane',
      otc: true,
      notes: 'Cap of 4g/24h enforced; pharmacist may verify.',
    },
    antihistamine: { localName: 'antihistaminique', brand: 'Aerius', otc: true },
  },
  GB: {
    ibuprofen: { localName: 'ibuprofen', brand: 'Nurofen', otc: true },
    acetaminophen: { localName: 'paracetamol', brand: 'Panadol', otc: true },
  },
  US: {
    ibuprofen: { localName: 'ibuprofen', brand: 'Advil / Motrin', otc: true },
    acetaminophen: { localName: 'acetaminophen', brand: 'Tylenol', otc: true },
    paracetamol: {
      localName: 'acetaminophen',
      brand: 'Tylenol',
      otc: true,
      notes: 'In the US it\'s "acetaminophen", not "paracetamol".',
    },
  },
  DE: {
    ibuprofen: {
      localName: 'Ibuprofen',
      otc: true,
      notes: 'Apotheke only — not Drogerie / supermarket.',
    },
    acetaminophen: { localName: 'Paracetamol', otc: true },
  },
};

async function runPharmacyProductMapper(
  rawInput: PharmacyInput,
  ctx?: ToolContext
): Promise<{
  status: 'ok' | 'unavailable' | 'production_refused';
  message: string;
  match?: { localName: string; brand?: string; otc: boolean; notes?: string };
}> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = pharmacyInput.parse(rawInput);
  const cc = input.countryCode.toUpperCase();
  const key = input.productName.trim().toLowerCase();
  const map = PHARMACY_MAP[cc];
  if (!map) {
    return {
      status: 'unavailable',
      message: `No curated pharmacy mapping for ${cc} yet. Ask the traveler to show the original packaging or try a generic translation.`,
    };
  }
  const direct = map[key];
  if (!direct) {
    return {
      status: 'unavailable',
      message: `"${input.productName}" not in ${cc} pharmacy table. Curated entries: ${Object.keys(map).join(', ')}.`,
    };
  }
  return {
    status: 'ok',
    match: direct,
    message: `Local name: ${direct.localName}${direct.brand ? ` (brand: ${direct.brand})` : ''}. OTC=${direct.otc}.`,
  };
}

const pharmacyProductMapperTool: ToolDef = {
  name: 'pharmacy_product_mapper',
  internal: true,
  description:
    'Map a common pharmacy product (ibuprofen / acetaminophen / antihistamine / sunscreen / etc.) to its local-language name + dominant brand + OTC status, for ~10 common destinations. Pure curated table. Use when traveler asks "what\'s ibuprofen called in <country>".',
  inputSchema: pharmacyInput,
  jsonSchema: {
    type: 'object',
    required: ['countryCode', 'productName'],
    properties: {
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      productName: { type: 'string', minLength: 1, maxLength: 120 },
      fromLocale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: runPharmacyProductMapper,
};

// ── 6. electronics_adapter_checker (pure curated) ────────────────────

const adapterInput = z.object({
  fromCountryCode: z.string().length(2),
  toCountryCode: z.string().length(2),
});
type AdapterInput = z.infer<typeof adapterInput>;

interface PlugSpec {
  plugTypes: string[];
  voltage: 110 | 120 | 220 | 230 | 240 | 100;
  frequencyHz: 50 | 60;
}

const COUNTRY_PLUG_SPEC: Record<string, PlugSpec> = {
  US: { plugTypes: ['A', 'B'], voltage: 120, frequencyHz: 60 },
  CA: { plugTypes: ['A', 'B'], voltage: 120, frequencyHz: 60 },
  MX: { plugTypes: ['A', 'B'], voltage: 127, frequencyHz: 60 } as unknown as PlugSpec,
  AR: { plugTypes: ['I', 'C'], voltage: 220, frequencyHz: 50 },
  BR: { plugTypes: ['N', 'C'], voltage: 127, frequencyHz: 60 } as unknown as PlugSpec,
  CL: { plugTypes: ['L', 'C'], voltage: 220, frequencyHz: 50 },
  PE: { plugTypes: ['A', 'B', 'C'], voltage: 220, frequencyHz: 60 },
  CO: { plugTypes: ['A', 'B'], voltage: 110, frequencyHz: 60 },
  GB: { plugTypes: ['G'], voltage: 230, frequencyHz: 50 },
  IE: { plugTypes: ['G'], voltage: 230, frequencyHz: 50 },
  FR: { plugTypes: ['E', 'C'], voltage: 230, frequencyHz: 50 },
  DE: { plugTypes: ['F', 'C'], voltage: 230, frequencyHz: 50 },
  ES: { plugTypes: ['F', 'C'], voltage: 230, frequencyHz: 50 },
  IT: { plugTypes: ['F', 'L', 'C'], voltage: 230, frequencyHz: 50 },
  PT: { plugTypes: ['F', 'C'], voltage: 230, frequencyHz: 50 },
  CH: { plugTypes: ['J', 'C'], voltage: 230, frequencyHz: 50 },
  JP: { plugTypes: ['A', 'B'], voltage: 100, frequencyHz: 50 },
  KR: { plugTypes: ['F', 'C'], voltage: 220, frequencyHz: 60 },
  CN: { plugTypes: ['A', 'C', 'I'], voltage: 220, frequencyHz: 50 },
  AU: { plugTypes: ['I'], voltage: 230, frequencyHz: 50 },
  NZ: { plugTypes: ['I'], voltage: 230, frequencyHz: 50 },
  IN: { plugTypes: ['C', 'D', 'M'], voltage: 230, frequencyHz: 50 },
  AE: { plugTypes: ['G'], voltage: 230, frequencyHz: 50 },
  IL: { plugTypes: ['H', 'C'], voltage: 230, frequencyHz: 50 },
};

async function runElectronicsAdapterChecker(
  rawInput: AdapterInput,
  ctx?: ToolContext
): Promise<{
  status: 'ok' | 'unavailable' | 'production_refused';
  message: string;
  needsAdapter?: boolean;
  needsConverter?: boolean;
  recommendation?: string;
}> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = adapterInput.parse(rawInput);
  const from = COUNTRY_PLUG_SPEC[input.fromCountryCode.toUpperCase()];
  const to = COUNTRY_PLUG_SPEC[input.toCountryCode.toUpperCase()];
  if (!from || !to) {
    return {
      status: 'unavailable',
      message: `No plug spec for ${input.fromCountryCode} → ${input.toCountryCode}.`,
    };
  }

  const sharePlug = from.plugTypes.some(t => to.plugTypes.includes(t));
  const needsAdapter = !sharePlug;
  const needsConverter = Math.abs(from.voltage - to.voltage) > 20;

  let rec = '';
  if (!needsAdapter && !needsConverter) {
    rec = `Same plug + voltage as your home country — no adapter or converter needed. Just bring your charger.`;
  } else if (needsAdapter && !needsConverter) {
    rec = `Bring a Type-${to.plugTypes.join(' or Type-')} adapter. Voltage matches; modern phone / laptop chargers handle ${from.voltage}V ↔ ${to.voltage}V automatically — no converter needed.`;
  } else if (!needsAdapter && needsConverter) {
    rec = `Plug fits, BUT voltage differs (${from.voltage}V → ${to.voltage}V). Modern phones / laptops auto-handle; hairdryers / curling irons need a step-up/down converter.`;
  } else {
    rec = `Need both: Type-${to.plugTypes.join(' or Type-')} adapter AND voltage check (${from.voltage}V → ${to.voltage}V). Phone/laptop chargers usually fine. Hairdryers / heated tools — check the rating, leave at home if it says ${from.voltage}V only.`;
  }

  return {
    status: 'ok',
    needsAdapter,
    needsConverter,
    recommendation: rec,
    message: `${input.fromCountryCode} → ${input.toCountryCode}: adapter=${needsAdapter}, converter=${needsConverter}.`,
  };
}

const electronicsAdapterCheckerTool: ToolDef = {
  name: 'electronics_adapter_checker',
  internal: true,
  description:
    "Check plug type + voltage between traveler's home country and destination. Returns whether adapter and/or voltage converter is needed, with a plain-English recommendation. Pure curated table covering 24 common destinations. Use when traveler asks 'do I need an adapter for <country>'.",
  inputSchema: adapterInput,
  jsonSchema: {
    type: 'object',
    required: ['fromCountryCode', 'toCountryCode'],
    properties: {
      fromCountryCode: { type: 'string', minLength: 2, maxLength: 2 },
      toCountryCode: { type: 'string', minLength: 2, maxLength: 2 },
    },
  },
  handler: runElectronicsAdapterChecker,
};

// ── 7. luggage_repair_finder (Places + CSE) ──────────────────────────

async function placesFinder(
  query: string,
  input: BaseInput,
  filterRegex: RegExp,
  ctx?: ToolContext
): Promise<{
  status: 'ok' | 'unavailable' | 'production_refused';
  message: string;
  results?: Array<{ name: string; rationale: string; url?: string; rating?: number }>;
}> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const places = await searchText({
    query: `${query} in ${input.city}`,
    limit: input.limit + 4,
    languageCode: input.languageCode,
    ...(input.countryCode ? { regionCode: input.countryCode } : {}),
  });
  if (!places.available)
    return { status: 'unavailable', message: `Places unavailable: ${places.reason ?? 'unknown'}.` };
  const filtered = places.results.filter(p =>
    filterRegex.test(`${p.name} ${p.editorialSummary ?? ''} ${p.types?.join(' ') ?? ''}`)
  );
  return {
    status: 'ok',
    results: filtered.slice(0, input.limit).map(p => ({
      name: p.name,
      rationale: `${p.rating?.toFixed(1) ?? '?'}★ over ${p.userRatingCount ?? 0} reviews · ${p.editorialSummary ?? p.formattedAddress ?? ''}`,
      ...(p.website ? { url: p.website } : {}),
      ...(typeof p.rating === 'number' ? { rating: p.rating } : {}),
    })),
    message: `${filtered.length} ${query} candidates in ${input.city}.`,
  };
}

const luggageRepairFinderTool: ToolDef = {
  name: 'luggage_repair_finder',
  internal: true,
  description:
    'Find luggage repair shops + urgent fix locations. Places-only with name/editorial filter ("luggage", "suitcase", "leather repair"). Use when traveler asks "luggage repair <city>", "broken zipper" mid-trip.',
  inputSchema: baseInput,
  jsonSchema: { type: 'object', required: ['city'], properties: { ...baseJsonProps } },
  handler: ((input: BaseInput, ctx?: ToolContext) =>
    placesFinder(
      'luggage repair shop',
      input,
      /\b(luggage|suitcase|leather repair|zipper|maleta|reparación)\b/i,
      ctx
    )) as ToolDef['handler'],
};

const laundryServiceFinderTool: ToolDef = {
  name: 'laundry_service_finder',
  internal: true,
  description:
    'Find laundry + pickup-and-delivery laundry services in a city. Places-only with name filter (lavandería / laundromat / dry cleaner). Use when traveler asks "laundry near my hotel <city>".',
  inputSchema: baseInput,
  jsonSchema: { type: 'object', required: ['city'], properties: { ...baseJsonProps } },
  handler: ((input: BaseInput, ctx?: ToolContext) =>
    placesFinder(
      'laundry service',
      input,
      /\b(laundry|laundromat|lavander|dry clean|tintorería)\b/i,
      ctx
    )) as ToolDef['handler'],
};

const tailorUrgentFinderTool: ToolDef = {
  name: 'tailor_urgent_finder',
  internal: true,
  description:
    'Find tailor shops + urgent alterations. Places + name filter. Use when traveler needs to hem a suit before a meeting / fix a tear before a wedding.',
  inputSchema: baseInput,
  jsonSchema: { type: 'object', required: ['city'], properties: { ...baseJsonProps } },
  handler: ((input: BaseInput, ctx?: ToolContext) =>
    placesFinder(
      'tailor alterations same day',
      input,
      /\b(tailor|sastr|alterations|costur)\b/i,
      ctx
    )) as ToolDef['handler'],
};

const vintageThriftFinderTool: ToolDef = {
  name: 'vintage_thrift_finder',
  internal: true,
  description:
    'Find vintage + thrift shops. Places + filter on second-hand / thrift / vintage / rastro / segunda mano. Use when traveler asks "vintage <city>", "thrift store <city>".',
  inputSchema: baseInput,
  jsonSchema: { type: 'object', required: ['city'], properties: { ...baseJsonProps } },
  handler: ((input: BaseInput, ctx?: ToolContext) =>
    placesFinder(
      'vintage thrift store',
      input,
      /\b(vintage|thrift|second-hand|consignment|segunda mano|rastro)\b/i,
      ctx
    )) as ToolDef['handler'],
};

const craftBeerFinderTool: ToolDef = {
  name: 'craft_beer_finder',
  internal: true,
  description:
    'Find craft taprooms + breweries + beer events. Places + filter on brewery / taproom / cervecería. Use when traveler asks "craft beer <city>", "taproom <city>", "cervecería artesanal".',
  inputSchema: baseInput,
  jsonSchema: { type: 'object', required: ['city'], properties: { ...baseJsonProps } },
  handler: ((input: BaseInput, ctx?: ToolContext) =>
    placesFinder(
      'craft beer brewery taproom',
      input,
      /\b(brewery|taproom|cervecer|brewpub|microbrew)\b/i,
      ctx
    )) as ToolDef['handler'],
};

// ── 11. personal_shopper_light (composer) ────────────────────────────

const personalShopperInput = baseInput.extend({
  styleHints: z.array(z.string().max(60)).max(8).optional(),
  budgetTier: z.enum(['budget', 'medium', 'premium', 'splurge']).default('medium'),
});
type PersonalShopperInput = z.infer<typeof personalShopperInput>;

interface ShoppingRoute {
  district: string;
  stops: Array<{ name: string; rationale: string; url?: string }>;
  pacingNote: string;
}

async function runPersonalShopperLight(
  rawInput: PersonalShopperInput,
  ctx?: ToolContext
): Promise<{
  status: 'ok' | 'unavailable' | 'production_refused';
  message: string;
  route?: ShoppingRoute;
}> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = personalShopperInput.parse(rawInput);
  // Compose: shopping_district_brief (for the area) + local_designer_finder (for stops).
  const district = await shoppingDistrictBriefTool.handler(input as never, ctx);
  const designers = await localDesignerFinderTool.handler(input as never, ctx);

  if (district.status !== 'ok' || designers.status !== 'ok') {
    return {
      status: 'unavailable',
      message: `Couldn't compose shopping route. district=${district.status}, designers=${designers.status}.`,
    };
  }
  const districtName = district.shops[0]?.name ?? `${input.city} central shopping`;
  return {
    status: 'ok',
    route: {
      district: districtName,
      stops: designers.shops.slice(0, Math.min(input.limit, 6)).map(s => ({
        name: s.name,
        rationale: s.rationale,
        ...(s.website ? { url: s.website } : {}),
      })),
      pacingNote:
        input.limit <= 4
          ? 'Quick route — 90min covers it. Hit the top stops.'
          : 'Half-day route — pace for 3-4h with one coffee mid-way.',
    },
    message: `Shopping route: ${districtName} → ${Math.min(input.limit, designers.shops.length)} stops.`,
  };
}

const personalShopperLightTool: ToolDef = {
  name: 'personal_shopper_light',
  internal: true,
  description:
    "Build a half-day shopping route for a city — composes `shopping_district_brief` + `local_designer_finder` into one ordered route with pacing note. Use when traveler asks 'plan my shopping afternoon in <city>', 'shopping route <city>'.",
  inputSchema: personalShopperInput,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      ...baseJsonProps,
      styleHints: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 60 } },
      budgetTier: { type: 'string', enum: ['budget', 'medium', 'premium', 'splurge'] },
    },
  },
  handler: runPersonalShopperLight,
};

// ── exports ──────────────────────────────────────────────────────────

export {
  shoppingDistrictBriefTool,
  localDesignerFinderTool,
  marketDayFinderTool,
  giftRecommenderTool,
  pharmacyProductMapperTool,
  electronicsAdapterCheckerTool,
  luggageRepairFinderTool,
  laundryServiceFinderTool,
  tailorUrgentFinderTool,
  personalShopperLightTool,
  vintageThriftFinderTool,
  craftBeerFinderTool,
  runMarketDayFinder,
  runGiftRecommender,
  runPharmacyProductMapper,
  runElectronicsAdapterChecker,
};
