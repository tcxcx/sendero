'use client';

import type { MouseEvent } from 'react';

import Link from 'next/link';

import { motion, useReducedMotion } from 'framer-motion';

export interface DocsPathCard {
  href: string;
  label: string;
  title: string;
  description: string;
  image: string;
  alt: string;
}

export function DocsPathCards({ cards }: { cards: readonly DocsPathCard[] }) {
  const reduceMotion = useReducedMotion();

  const handlePrimaryClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }

    const href = event.currentTarget.getAttribute('href');
    if (!href) {
      return;
    }

    event.preventDefault();
    window.location.assign(href);
  };

  return (
    <section className="docs-paths" aria-label="Choose a docs path">
      {cards.map((card, index) => (
        <motion.article
          className="docs-path-motion"
          initial={reduceMotion ? false : { opacity: 0, y: 18 }}
          key={card.href}
          transition={{ duration: 0.54, delay: index * 0.07, ease: [0.16, 1, 0.3, 1] }}
          viewport={{ once: true, amount: 0.28 }}
          whileHover={reduceMotion ? undefined : { y: -7 }}
          whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
          whileTap={reduceMotion ? undefined : { y: -2 }}
        >
          <Link className="docs-path-card" href={card.href} onClick={handlePrimaryClick}>
            <span className="docs-path-image-frame">
              <img alt={card.alt} decoding="async" src={card.image} />
            </span>
            <span className="docs-path-copy">
              <span className="docs-path-label">{card.label}</span>
              <strong>{card.title}</strong>
              <span className="docs-path-description">{card.description}</span>
              <span className="docs-path-cta">
                Open route <span aria-hidden="true">-&gt;</span>
              </span>
            </span>
          </Link>
        </motion.article>
      ))}
    </section>
  );
}
