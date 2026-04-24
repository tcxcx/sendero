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
  /**
   * Three-tier surface palette used across the authenticated product.
   * Hierarchy is built from elevation (shadow + tone), never outlines.
   */
  surfaces: {
    base: {
      name: 'Parchment (base field)',
      hex: '#EEDCC7',
      role: 'Page field — what raised cards float on.',
    },
    raised: {
      name: 'Parchment Light (raised)',
      hex: '#F7EFE4',
      role: 'Primary content cards: trip lists, threads, context panels.',
    },
    floating: {
      name: 'Warm White (floating)',
      hex: '#FDFBF7',
      role: 'Popovers, menus, modals, active/selected list cards.',
    },
    terminal: {
      name: 'Midnight Veil (terminal)',
      rgba: 'rgba(31, 42, 68, 0.97)',
      role: 'Workflow / console panels — parchment whispers through.',
    },
  },
  /** Midnight-tinted shadow scale. Never pure black. */
  shadows: {
    xs: '0 1px 2px rgba(31, 42, 68, 0.04)',
    sm: '0 1px 2px rgba(31, 42, 68, 0.04), 0 4px 12px -6px rgba(31, 42, 68, 0.06)',
    md: '0 1px 2px rgba(31, 42, 68, 0.04), 0 8px 24px -12px rgba(31, 42, 68, 0.08)',
    lg: '0 2px 4px rgba(31, 42, 68, 0.06), 0 16px 40px -16px rgba(31, 42, 68, 0.14)',
    xl: '0 2px 4px rgba(31, 42, 68, 0.06), 0 24px 48px -20px rgba(31, 42, 68, 0.18)',
    terminal: '0 2px 4px rgba(31, 42, 68, 0.12), 0 24px 48px -20px rgba(31, 42, 68, 0.35)',
  },
  /** Tinted fills for active states, chip backgrounds, hover. */
  tints: {
    vermillionSoft: 'rgba(214, 84, 56, 0.10)',
    vermillionMedium: 'rgba(214, 84, 56, 0.18)',
    seaSoft: 'rgba(15, 124, 130, 0.10)',
    sandSoft: 'rgba(182, 132, 78, 0.12)',
    midnightSoft: 'rgba(31, 42, 68, 0.04)',
    midnightMedium: 'rgba(31, 42, 68, 0.08)',
  },
  /** Named radius scale. */
  radii: {
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '20px',
  },
  /**
   * Hairline borders — editorial rhythm only, never structural chrome.
   * Paired with surface tiers rather than replacing them.
   */
  hairlines: {
    color: '#D8C1A7',
    colorSoft: 'rgba(31, 42, 68, 0.08)',
    colorStrong: 'rgba(31, 42, 68, 0.14)',
  },
  /** Dotted-grid graticule used behind micro-illustrations. */
  dotGrid: {
    color: 'rgba(31, 42, 68, 0.18)',
    sizePx: 8,
  },
  /** Editorial numeral scale for dashboard KPIs / marketing stats. */
  numerals: {
    xl: 'clamp(3.5rem, 6vw, 5.5rem)',
    lg: 'clamp(2.75rem, 4.5vw, 4rem)',
    md: 'clamp(2rem, 3vw, 2.75rem)',
  },
  /** Small-caps label spec — 11px w/ 0.12em tracking. */
  labelMeta: {
    sizeRem: 0.6875,
    trackingEm: 0.12,
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
  motion: {
    metaphor: 'paper, ink, route tracing, and quiet operational state changes',
    easeOut: 'cubic-bezier(0.23, 1, 0.32, 1)',
    easeInOut: 'cubic-bezier(0.77, 0, 0.175, 1)',
    timings: {
      pressMs: '100-160',
      smallFeedbackMs: '140-220',
      pageEntranceMs: '360-760',
      heroImageMs: '700-1100',
    },
    principles: [
      'animate rare orientation moments, not repeated operator actions',
      'use opacity plus small translate or scale, never scale from zero',
      'buttons and pressable cards should respond immediately on active press',
      'route-line motion should feel drawn in ink, not neon or futuristic',
      'honor prefers-reduced-motion on every app',
    ],
  },
  assets: {
    brandBookPdf: '/brand/sendero_brand_book.pdf',
    logo: '/brand/sendero-logo.png',
    banner: '/brand/sendero-banner.png',
    wordmarkBanner: '/brand/sendero-banner.png',
    heroBanner: '/brand/hero-banner.png',
    wideTravelMap: '/brand/hero-banner.png',
    heroTransparent: '/brand/hero-transparent.png',
    transparentMapFrame: '/brand/sendero-map-frame-transparent.png',
    stampSheet: '/brand/aspect-ratio-asset-stamps.png',
  },
} as const;

export type SenderoBrand = typeof senderoBrand;
