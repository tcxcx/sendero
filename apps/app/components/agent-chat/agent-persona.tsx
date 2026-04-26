'use client';

/**
 * AgentPersona — Sendero-branded state indicator paired with the Rive Persona.
 *
 * Visually distinct from `Persona`: where the Rive avatar is a generic AI
 * presence cue, AgentPersona surfaces Sendero brand voice. The brand mark
 * sits inside an animated halo whose motion vocabulary is hand-tuned per
 * chat phase (idle breath, listening pulse, thinking spin, speaking thump,
 * asleep dim). Driven by `motion/react` rather than Rive so the bundle stays
 * light and the animation can be re-tuned without re-exporting a `.riv` file.
 */

import { motion } from 'motion/react';
import Image from 'next/image';

import { cn } from '@sendero/ui/cn';

import type { PersonaState } from '@/components/ai-elements/persona';

interface AgentPersonaProps {
  state: PersonaState;
  className?: string;
}

const BRAND_MARK = '/brand/logo-masters/clean/sendero_icon_vermilion_clean_2048.png';

interface StateChoreography {
  scale: number | number[];
  rotate?: number | number[];
  opacity: number | number[];
  duration: number;
  ringOpacity: number | number[];
  ringScale: number | number[];
}

const choreography: Record<PersonaState, StateChoreography> = {
  idle: {
    scale: [1, 1.02, 1],
    opacity: 1,
    duration: 4,
    ringOpacity: [0.18, 0.28, 0.18],
    ringScale: [1, 1.04, 1],
  },
  listening: {
    scale: [1, 1.015, 1],
    opacity: 1,
    duration: 1.6,
    ringOpacity: [0.25, 0.55, 0.25],
    ringScale: [1, 1.18, 1],
  },
  thinking: {
    scale: [1, 1.01, 1],
    rotate: [0, 360],
    opacity: 0.85,
    duration: 6,
    ringOpacity: [0.2, 0.4, 0.2],
    ringScale: [1, 1.08, 1],
  },
  speaking: {
    scale: [1, 1.05, 1],
    opacity: 1,
    duration: 0.6,
    ringOpacity: [0.35, 0.7, 0.35],
    ringScale: [1, 1.12, 1],
  },
  asleep: {
    scale: 1,
    opacity: 0.4,
    duration: 8,
    ringOpacity: 0.08,
    ringScale: 1,
  },
};

export function AgentPersona({ state, className }: AgentPersonaProps) {
  const motionSpec = choreography[state];
  const accent =
    state === 'speaking' || state === 'listening'
      ? 'var(--accent-vermillion)'
      : state === 'thinking'
        ? 'var(--accent-amber)'
        : state === 'asleep'
          ? 'var(--text-faint)'
          : 'var(--ink)';

  return (
    <div
      role="img"
      aria-label={`Sendero agent ${state}`}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        className
      )}
    >
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{
          boxShadow: `0 0 0 2px color-mix(in oklab, ${accent} 60%, transparent)`,
        }}
        animate={{
          opacity: motionSpec.ringOpacity,
          scale: motionSpec.ringScale,
        }}
        transition={{
          duration: motionSpec.duration,
          ease: 'easeInOut',
          repeat: Number.POSITIVE_INFINITY,
        }}
      />
      <motion.span
        className="relative inline-flex h-[72%] w-[72%] items-center justify-center rounded-full bg-[color:var(--surface-raised)]"
        animate={{
          scale: motionSpec.scale,
          rotate: motionSpec.rotate ?? 0,
          opacity: motionSpec.opacity,
        }}
        transition={{
          duration: motionSpec.duration,
          ease: state === 'thinking' ? 'linear' : 'easeInOut',
          repeat: Number.POSITIVE_INFINITY,
          repeatType: state === 'thinking' ? 'loop' : 'mirror',
        }}
      >
        <Image
          src={BRAND_MARK}
          alt=""
          width={64}
          height={64}
          className="h-[72%] w-[72%] select-none"
          priority={false}
          draggable={false}
        />
      </motion.span>
    </div>
  );
}
