export const senderoBrand = {
  name: 'Sendero',
  metaphor: 'A smart travel guide with taste.',
  internalRule:
    "Sendero should feel like an intelligent explorer's mark, not a generic travel app logo.",
  personality: [
    'intelligent',
    'curious',
    'editorial',
    'warm',
    'guided',
    'premium but approachable',
  ],
  colors: {
    vermillion: {
      name: 'Vermillion',
      hex: '#D65438',
      hsl: '11 66% 53%',
      role: 'Primary brand expression, key identity moments, icons, hero branding.',
    },
    midnight: {
      name: 'Midnight',
      hex: '#1F2A44',
      hsl: '222 37% 19%',
      role: 'Trusted/system expression, dark mode, documentation, formal presentation contexts.',
    },
    sea: {
      name: 'Sea',
      hex: '#0F7C82',
      hsl: '183 79% 28%',
      role: 'Functional travel expression, map-related features, operations accents.',
    },
    sand: {
      name: 'Sand',
      hex: '#B6844E',
      hsl: '31 42% 51%',
      role: 'Warm editorial expression, hospitality contexts, softer supporting moments.',
    },
    parchment: {
      name: 'Parchment',
      hex: '#EEDCC7',
      hsl: '32 53% 86%',
      role: 'Primary page background, old-paper brand surface, and image-safe editorial field.',
    },
    paper: {
      name: 'Paper',
      hex: '#EEDCC7',
      role: 'Default warm background for product and editorial surfaces.',
    },
    cream: {
      name: 'Cream',
      hex: '#F5E7D6',
      role: 'Lighter elevated parchment tone for cards, panels, and captions.',
    },
  },
  icon: {
    name: 'Binocular mark',
    meaning: 'Discovery + wayfinding + destination intelligence.',
    elements: [
      'rounded binocular body',
      'balanced two-lens structure',
      'star in left lens',
      'mountain line in right lens',
      'single-color outline logic',
      'simple internal detail',
    ],
    clearSpace: '25% of icon width on all sides',
    minimumDigitalHeightPx: 24,
    preferredDigitalHeightPx: 64,
    minimumPrintHeightMm: 12,
  },
  illustration: {
    preferred: [
      'hand-drawn linework',
      'path motifs',
      'stamp/seal references',
      'route logic',
      'subtle explorer cues',
      'horizon imagery',
      'print texture',
      'limited palette',
    ],
    avoid: [
      'cartoon overload',
      'literal AI robots',
      'futuristic UI imagery',
      'excessive detail at small sizes',
      'shiny startup gradients',
      'glassmorphism',
      'generic tech blue as default',
    ],
  },
  assets: {
    brandBookPdf: '/brand/sendero_brand_book.pdf',
    logo: '/brand/sendero-logo.png',
    banner: '/brand/sendero-banner.png',
    heroBanner: '/brand/hero-banner.png',
    heroTransparent: '/brand/hero-transparent.png',
    stampSheet: '/brand/aspect-ratio-asset-stamps.png',
  },
} as const;

export type SenderoBrand = typeof senderoBrand;
