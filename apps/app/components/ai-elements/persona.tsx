'use client';

import { cn } from '@sendero/ui/cn';
import type { RiveParameters } from '@rive-app/react-webgl2';
import {
  useRive,
  useStateMachineInput,
  useViewModel,
  useViewModelInstance,
  useViewModelInstanceColor,
} from '@rive-app/react-webgl2';
import type { FC, ReactNode } from 'react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

// Delays Rive initialization by one frame so that React Strict Mode's
// immediate unmount cycle never creates a WebGL2 context. Only the
// second (real) mount will initialise, avoiding context exhaustion.
const useStrictModeSafeInit = () => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => {
      cancelAnimationFrame(id);
      setReady(false);
    };
  }, []);

  return ready;
};

// WebGL2 isn't universal — headless browsers, older Safari, locked-down
// VMs, and machines that have exhausted their context budget all return
// null from getContext('webgl2'). Without this guard, Rive's makeRenderer
// blows up with `Cannot read properties of null (reading 'T')`. Detect
// once on mount and short-circuit to a static placeholder when missing.
const useWebGL2Available = () => {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2');
      if (gl) {
        const lose = gl.getExtension('WEBGL_lose_context');
        lose?.loseContext();
        setAvailable(true);
      } else {
        setAvailable(false);
      }
    } catch {
      setAvailable(false);
    }
  }, []);

  return available;
};

export type PersonaState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'asleep';

interface PersonaProps {
  state: PersonaState;
  onLoad?: RiveParameters['onLoad'];
  onLoadError?: RiveParameters['onLoadError'];
  onReady?: () => void;
  onPause?: RiveParameters['onPause'];
  onPlay?: RiveParameters['onPlay'];
  onStop?: RiveParameters['onStop'];
  className?: string;
  variant?: keyof typeof sources;
  /**
   * Override the auto theme-derived color of the Rive halo. Accepts
   * any CSS color string (`#fb542b`, `rgb(251 84 43)`, `var(--ink)`)
   * and gets parsed to an RGB triple before being pushed into the
   * Rive view-model's `color` instance. Only applies to variants
   * with `dynamicColor: true` (halo, command, glint, obsidian).
   */
  color?: string;
}

// The state machine name is always 'default' for Elements AI visuals
const stateMachine = 'default';

const sources = {
  command: {
    dynamicColor: true,
    hasModel: true,
    source: 'https://ejiidnob33g9ap1r.public.blob.vercel-storage.com/command-2.0.riv',
  },
  glint: {
    dynamicColor: true,
    hasModel: true,
    source: 'https://ejiidnob33g9ap1r.public.blob.vercel-storage.com/glint-2.0.riv',
  },
  halo: {
    dynamicColor: true,
    hasModel: true,
    source: 'https://ejiidnob33g9ap1r.public.blob.vercel-storage.com/halo-2.0.riv',
  },
  mana: {
    dynamicColor: false,
    hasModel: true,
    source: 'https://ejiidnob33g9ap1r.public.blob.vercel-storage.com/mana-2.0.riv',
  },
  obsidian: {
    dynamicColor: true,
    hasModel: true,
    source: 'https://ejiidnob33g9ap1r.public.blob.vercel-storage.com/obsidian-2.0.riv',
  },
  opal: {
    dynamicColor: false,
    hasModel: false,
    source: 'https://ejiidnob33g9ap1r.public.blob.vercel-storage.com/orb-1.2.riv',
  },
};

const getCurrentTheme = (): 'light' | 'dark' => {
  if (typeof window !== 'undefined') {
    if (document.documentElement.classList.contains('dark')) {
      return 'dark';
    }
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  }
  return 'light';
};

const useTheme = (enabled: boolean) => {
  const [theme, setTheme] = useState<'light' | 'dark'>(getCurrentTheme);

  useEffect(() => {
    // Skip if not enabled (avoids unnecessary observers for non-dynamic-color variants)
    if (!enabled) {
      return;
    }

    // Watch for classList changes
    const observer = new MutationObserver(() => {
      setTheme(getCurrentTheme());
    });

    observer.observe(document.documentElement, {
      attributeFilter: ['class'],
      attributes: true,
    });

    // Watch for OS-level theme changes
    let mql: MediaQueryList | null = null;
    const handleMediaChange = () => {
      setTheme(getCurrentTheme());
    };

    if (window.matchMedia) {
      mql = window.matchMedia('(prefers-color-scheme: dark)');
      mql.addEventListener('change', handleMediaChange);
    }

    return () => {
      observer.disconnect();
      if (mql) {
        mql.removeEventListener('change', handleMediaChange);
      }
    };
  }, [enabled]);

  return theme;
};

interface PersonaWithModelProps {
  rive: ReturnType<typeof useRive>['rive'];
  source: (typeof sources)[keyof typeof sources];
  /** Optional CSS-color override; takes precedence over the theme-default. */
  color?: string;
  children: React.ReactNode;
}

/**
 * Resolve a CSS color string to an [r, g, b] triple in 0-255 space.
 * Returns null when the browser can't parse it (server-side render or
 * malformed input). The trick: paint into a 1x1 canvas and read back
 * the computed pixel — handles named colors, hex, rgb(), oklch, etc.
 */
function cssColorToRgb(color: string): [number, number, number] | null {
  if (typeof document === 'undefined') return null;
  try {
    const probe = document.createElement('canvas');
    probe.width = probe.height = 1;
    const ctx = probe.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return [r ?? 0, g ?? 0, b ?? 0];
  } catch {
    return null;
  }
}

/**
 * Read a CSS custom property's resolved value off the document root,
 * then push it through `cssColorToRgb`. Lets callers pass `var(--ink)`
 * or any other token name and have the actual value reach Rive.
 */
function resolveColorToken(value: string): [number, number, number] | null {
  if (typeof document === 'undefined') return null;
  const trimmed = value.trim();
  if (trimmed.startsWith('var(')) {
    const tokenName = trimmed.slice(4, -1).split(',')[0]?.trim();
    if (!tokenName) return null;
    const resolved = getComputedStyle(document.documentElement).getPropertyValue(tokenName).trim();
    if (!resolved) return null;
    return cssColorToRgb(resolved);
  }
  return cssColorToRgb(trimmed);
}

const PersonaWithModel = memo(({ rive, source, color, children }: PersonaWithModelProps) => {
  const theme = useTheme(source.dynamicColor);
  const viewModel = useViewModel(rive, { useDefault: true });
  const viewModelInstance = useViewModelInstance(viewModel, {
    rive,
    useDefault: true,
  });
  const viewModelInstanceColor = useViewModelInstanceColor('color', viewModelInstance);

  useEffect(() => {
    if (!(viewModelInstanceColor && source.dynamicColor)) {
      return;
    }

    if (color) {
      const rgb = resolveColorToken(color);
      if (rgb) {
        viewModelInstanceColor.setRgb(rgb[0], rgb[1], rgb[2]);
        return;
      }
    }

    const [r, g, b] = theme === 'dark' ? [255, 255, 255] : [0, 0, 0];
    viewModelInstanceColor.setRgb(r, g, b);
  }, [viewModelInstanceColor, theme, source.dynamicColor, color]);

  return children;
});

PersonaWithModel.displayName = 'PersonaWithModel';

interface PersonaWithoutModelProps {
  children: ReactNode;
  /** Ignored — kept so PersonaInner can pass it uniformly. */
  rive?: ReturnType<typeof useRive>['rive'];
  source?: (typeof sources)[keyof typeof sources];
  color?: string;
}

const PersonaWithoutModel = memo(({ children }: PersonaWithoutModelProps) => children);

PersonaWithoutModel.displayName = 'PersonaWithoutModel';

interface PersonaInnerProps {
  source: (typeof sources)[keyof typeof sources];
  state: PersonaState;
  callbacks: {
    onLoad: RiveParameters['onLoad'];
    onLoadError: RiveParameters['onLoadError'];
    onPause: RiveParameters['onPause'];
    onPlay: RiveParameters['onPlay'];
    onReady: () => void;
    onStop: RiveParameters['onStop'];
  };
  className?: string;
  color?: string;
}

const PersonaInner: FC<PersonaInnerProps> = ({ source, state, callbacks, className, color }) => {
  const { rive, RiveComponent } = useRive({
    autoplay: true,
    onLoad: callbacks.onLoad,
    onLoadError: callbacks.onLoadError,
    onPause: callbacks.onPause,
    onPlay: callbacks.onPlay,
    onRiveReady: callbacks.onReady,
    onStop: callbacks.onStop,
    src: source.source,
    stateMachines: stateMachine,
  });

  const listeningInput = useStateMachineInput(rive, stateMachine, 'listening');
  const thinkingInput = useStateMachineInput(rive, stateMachine, 'thinking');
  const speakingInput = useStateMachineInput(rive, stateMachine, 'speaking');
  const asleepInput = useStateMachineInput(rive, stateMachine, 'asleep');

  // Rive state machine inputs are mutable objects that must be set via direct
  // property assignment — this is the intended Rive API, not a React anti-pattern.
  useEffect(() => {
    if (listeningInput) {
      listeningInput.value = state === 'listening';
    }
    if (thinkingInput) {
      thinkingInput.value = state === 'thinking';
    }
    if (speakingInput) {
      speakingInput.value = state === 'speaking';
    }
    if (asleepInput) {
      asleepInput.value = state === 'asleep';
    }
  }, [state, listeningInput, thinkingInput, speakingInput, asleepInput]);

  const Component = source.hasModel ? PersonaWithModel : PersonaWithoutModel;

  return (
    <Component rive={rive} source={source} color={color}>
      <RiveComponent className={cn('size-16 shrink-0', className)} />
    </Component>
  );
};

export const Persona: FC<PersonaProps> = memo(
  ({
    variant = 'obsidian',
    state = 'idle',
    onLoad,
    onLoadError,
    onReady,
    onPause,
    onPlay,
    onStop,
    className,
    color,
  }) => {
    const source = sources[variant];

    if (!source) {
      throw new Error(`Invalid variant: ${variant}`);
    }

    // Stabilize callbacks to prevent useRive from reinitializing
    const callbacksRef = useRef({
      onLoad,
      onLoadError,
      onPause,
      onPlay,
      onReady,
      onStop,
    });

    useEffect(() => {
      callbacksRef.current = {
        onLoad,
        onLoadError,
        onPause,
        onPlay,
        onReady,
        onStop,
      };
    }, [onLoad, onLoadError, onPause, onPlay, onReady, onStop]);

    const stableCallbacks = useMemo(
      () => ({
        onLoad: (loadedRive =>
          callbacksRef.current.onLoad?.(loadedRive)) as RiveParameters['onLoad'],
        onLoadError: (err =>
          callbacksRef.current.onLoadError?.(err)) as RiveParameters['onLoadError'],
        onPause: (event => callbacksRef.current.onPause?.(event)) as RiveParameters['onPause'],
        onPlay: (event => callbacksRef.current.onPlay?.(event)) as RiveParameters['onPlay'],
        onReady: () => callbacksRef.current.onReady?.(),
        onStop: (event => callbacksRef.current.onStop?.(event)) as RiveParameters['onStop'],
      }),
      []
    );

    // Gate the entire Rive subtree behind a one-frame delay AND a WebGL2
    // capability probe. The canvas only ever mounts once, with real params,
    // and only when WebGL2 is actually available — Strict Mode's throw-away
    // first mount never creates a context, useRive is never called with
    // null, and headless / WebGL1-only browsers degrade to a static
    // placeholder instead of crashing in `makeRenderer`.
    const ready = useStrictModeSafeInit();
    const webgl2 = useWebGL2Available();

    if (!ready || webgl2 !== true) {
      return <div aria-hidden="true" className={cn('size-16 shrink-0', className)} />;
    }

    return (
      <PersonaInner
        source={source}
        state={state}
        callbacks={stableCallbacks}
        className={className}
        color={color}
      />
    );
  }
);

Persona.displayName = 'Persona';
