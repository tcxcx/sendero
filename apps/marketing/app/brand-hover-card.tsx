'use client';

import { HoverCard, HoverCardContent, HoverCardTrigger } from '@sendero/ui/hover-card';

type Locale = 'en-US' | 'es-MX' | 'es-AR' | 'pt-BR';

interface CardCopy {
  kicker: string;
  title: string;
  body: string;
  bullets: string[];
  ctaLabel: string;
}

const COPY: Record<Locale, CardCopy> = {
  'en-US': {
    kicker: 'Sendero for everyone',
    title: 'Run your own travel agency.',
    body: 'Solo desk or global TMC, Sendero runs the back office. Every agent ships with on-chain reviews + stars — earn reputation and the AI economy starts routing customers to you.',
    bullets: [
      'Free workspace + sandbox',
      'On-chain reviews + stars',
      'Discoverable by AI agents globally',
    ],
    ctaLabel: 'Start free →',
  },
  'es-MX': {
    kicker: 'Sendero para todos',
    title: 'Lanza tu propia agencia.',
    body: 'Escritorio solo o TMC global, Sendero corre el back office. Cada agente trae reviews y estrellas on-chain — gana reputación y la economía IA empieza a rutear clientes hacia ti.',
    bullets: [
      'Workspace gratis + sandbox',
      'Reviews + estrellas on-chain',
      'Descubrible por agentes IA globalmente',
    ],
    ctaLabel: 'Empezar gratis →',
  },
  'es-AR': {
    kicker: 'Sendero para todos',
    title: 'Lanzá tu propia agencia.',
    body: 'Escritorio solo o TMC global, Sendero corre el back office. Cada agente trae reviews y estrellas on-chain — ganate reputación y la economía IA empieza a rutear clientes hacia vos.',
    bullets: [
      'Workspace gratis + sandbox',
      'Reviews + estrellas on-chain',
      'Descubrible por agentes IA globalmente',
    ],
    ctaLabel: 'Empezar gratis →',
  },
  'pt-BR': {
    kicker: 'Sendero para todos',
    title: 'Lance sua própria agência.',
    body: 'Balcão solo ou TMC global, Sendero opera o back office. Cada agente traz reviews e estrelas on-chain — conquiste reputação e a economia IA começa a rotear clientes para você.',
    bullets: [
      'Workspace grátis + sandbox',
      'Reviews + estrelas on-chain',
      'Descobrível por agentes IA globalmente',
    ],
    ctaLabel: 'Começar grátis →',
  },
};

const START_FREE_HREF = '/dashboard';
const TRIGGER_LOGO = '/brand/logo-masters/clean/sendero_icon_midnight_navy_clean_2048.png';
const CARD_LOGO = '/brand/logo-masters/clean/sendero_icon_vermilion_clean_2048.png';

export function MarketingBrandHoverCard({ locale }: { locale: string }) {
  const copy = COPY[(locale as Locale) in COPY ? (locale as Locale) : 'en-US'];

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <a href={START_FREE_HREF} aria-label={copy.kicker} className="mk-brand-hover-trigger">
          <img alt="" decoding="async" src={TRIGGER_LOGO} />
        </a>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="end"
        sideOffset={12}
        collisionPadding={16}
        className="mk-brand-hover-card"
      >
        <div className="mk-brand-hover-head">
          <img alt="" decoding="async" src={CARD_LOGO} />
          <div className="mk-brand-hover-head-copy">
            <span className="mk-brand-hover-kicker">{copy.kicker}</span>
            <strong>{copy.title}</strong>
          </div>
        </div>
        <p className="mk-brand-hover-body">{copy.body}</p>
        <ul className="mk-brand-hover-bullets">
          {copy.bullets.map(bullet => (
            <li key={bullet}>
              <span className="mk-brand-hover-dot" aria-hidden="true" />
              {bullet}
            </li>
          ))}
        </ul>
        <a className="mk-brand-hover-cta" href={START_FREE_HREF}>
          {copy.ctaLabel}
        </a>
      </HoverCardContent>
    </HoverCard>
  );
}
